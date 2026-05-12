#!/usr/bin/env bash
set -euo pipefail

# Run the full data-prep pipeline for every configured site and sync into public/data/.
#
# Requirements:
# - data-prep/venv created and deps installed (see README)
# - Earth Engine auth:
#     - interactive: `earthengine authenticate`
#     - or service account:
#         export GEE_SERVICE_ACCOUNT_EMAIL="..."
#         export GEE_PRIVATE_KEY_FILE="/absolute/path/to/service-account.json"
#
# Usage:
#   bash scripts/run_pipeline_all_sites.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$ROOT/data-prep" ]]; then
  echo "Missing data-prep/ directory" >&2
  exit 1
fi

GEE_KEY="$ROOT/data-prep/gee-service-account-key.json"
if [[ -f "$GEE_KEY" ]]; then
  export GEE_PRIVATE_KEY_FILE="$GEE_KEY"
  export GEE_SERVICE_ACCOUNT_EMAIL="$(
    python3 - <<'PY'
import json
from pathlib import Path
info = json.loads(Path("data-prep/gee-service-account-key.json").read_text(encoding="utf-8"))
print(info["client_email"])
PY
  )"
  export GEE_PROJECT="${GEE_PROJECT:-southern-tempo-387417}"
fi

echo "→ Building site boundaries and downloading shared sources…"
(
  cd "$ROOT/data-prep"
  if [ -d "venv" ]; then
    source venv/bin/activate
  fi
  python build_site_boundaries.py
  python 01_download_sources.py
)

echo "→ Running pipeline for all sites…"
site_ids="$(python3 - <<'PY'
from pathlib import Path
import re

cfg = Path("data-prep/config.py").read_text(encoding="utf-8")
m = re.search(r"SITES\s*=\s*\{([\s\S]*?)\n\}", cfg)
if not m:
    raise SystemExit("Could not parse SITES from data-prep/config.py")
block = m.group(1)
ids = re.findall(r'"([a-z0-9_]+)"\s*:\s*\{', block)
print("\n".join(ids))
PY
)"

while read -r SITE_ID; do
  [[ -z "$SITE_ID" ]] && continue
  echo ""
  echo "==> SITE_ID=$SITE_ID"
  (cd "$ROOT/data-prep" && SITE_ID="$SITE_ID" SKIP_DOWNLOAD=1 bash run_all.sh)
  (cd "$ROOT" && SITE_ID="$SITE_ID" python3 scripts/sync_public_data.py)
done <<< "$site_ids"

echo ""
echo "✓ Done. Outputs synced into public/data/<siteId>/"
