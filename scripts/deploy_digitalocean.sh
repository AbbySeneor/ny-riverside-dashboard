#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v doctl >/dev/null 2>&1; then
  echo "Install doctl: https://docs.digitalocean.com/reference/doctl/how-to/install/"
  exit 1
fi

if [[ -z "${DIGITALOCEAN_ACCESS_TOKEN:-}" ]]; then
  DOCTL_CONFIG="${DOCTL_CONFIG:-$HOME/Library/Application Support/doctl/config.yaml}"
  if [[ -f "$DOCTL_CONFIG" ]]; then
  DIGITALOCEAN_ACCESS_TOKEN="$(python3 - <<'PY' "$DOCTL_CONFIG"
import re
import sys
from pathlib import Path

match = re.search(r"^access-token:\s*(\S+)\s*$", Path(sys.argv[1]).read_text(), re.M)
print(match.group(1) if match else "")
PY
)"
  fi
fi

if [[ -z "${DIGITALOCEAN_ACCESS_TOKEN:-}" ]]; then
  echo "Set DIGITALOCEAN_ACCESS_TOKEN or run: doctl auth init"
  exit 1
fi

export DIGITALOCEAN_ACCESS_TOKEN
if ! doctl account get --format Email --no-header >/dev/null 2>&1; then
  echo "DigitalOcean API authentication failed. Create a new token at https://cloud.digitalocean.com/account/api/tokens"
  echo "Then run: export DIGITALOCEAN_ACCESS_TOKEN='your_token' && ./scripts/deploy_digitalocean.sh"
  exit 1
fi

if [[ -f "$ROOT/.env.local" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT/.env.local"
  set +a
fi

if [[ -z "${VITE_MAPBOX_TOKEN:-}" ]]; then
  echo "Set VITE_MAPBOX_TOKEN in .env.local or the environment before deploying."
  exit 1
fi

SPEC="$(mktemp)"
trap 'rm -f "$SPEC"' EXIT

python3 - <<'PY' "$ROOT/.do/app.yaml" "$SPEC" "${VITE_MAPBOX_TOKEN}" "${VITE_SITE_ID:-west_harlem}"
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
token = sys.argv[3]
site_id = sys.argv[4]
out = src.replace(
    "      - key: VITE_MAPBOX_TOKEN\n        scope: BUILD_TIME\n        type: SECRET",
    f"      - key: VITE_MAPBOX_TOKEN\n        scope: BUILD_TIME\n        type: SECRET\n        value: {token}",
)
out = out.replace(
    "        value: west_harlem",
    f"        value: {site_id}",
)
Path(sys.argv[2]).write_text(out)
PY

APP_ID="$(doctl apps list --format ID,Spec.Name --no-header | awk '$2 == "treelyon-riverside" { print $1; exit }')"

if [[ -n "$APP_ID" ]]; then
  echo "Updating existing App Platform app $APP_ID"
  doctl apps update "$APP_ID" --spec "$SPEC"
else
  echo "Creating App Platform app from $ROOT/.do/app.yaml"
  APP_ID="$(doctl apps create --spec "$SPEC" --format ID --no-header)"
fi

doctl apps get "$APP_ID" --format ID,Spec.Name,DefaultIngress
