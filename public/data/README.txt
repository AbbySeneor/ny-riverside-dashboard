Dashboard data files live under public/data/<site_id>/ (e.g. west_harlem/).

They are not committed as demo fixtures. After you run the pipeline:

  cd data-prep && SITE_ID=west_harlem bash run_all.sh
  cd .. && SITE_ID=west_harlem python3 scripts/sync_public_data.py

(or: npm run sync:data)

Sources are documented in README.md (TNC LiDAR Zenodo, NYC Open Data, GEE, DOHMH HVI, etc.).
