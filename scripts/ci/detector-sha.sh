#!/usr/bin/env bash
# Print the pinned SHA-256 of the detector weights from tools/fetch_detector.py (used as the CI cache key).
set -euo pipefail
sha="$(sed -n 's/^SHA256 = "\([0-9a-f]\{64\}\)".*/\1/p' tools/fetch_detector.py)"
[ -n "$sha" ] || { echo "could not read SHA256 from tools/fetch_detector.py" >&2; exit 1; }
echo "$sha"
