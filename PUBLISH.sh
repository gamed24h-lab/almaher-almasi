#!/usr/bin/env bash
set -euo pipefail
python3 PATCH_V1_3.py
node --check worker/index.js
rm -f ALMAHER_FIXPACK_V1.3.zip PATCH_V1_3.py
git add -A
git commit -m "ALMAHER V1.3 combined operational fixes" || true
git push origin main
echo "DONE: ALMAHER V1.3 pushed to main"
