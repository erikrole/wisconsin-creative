#!/usr/bin/env bash
set -euo pipefail

# Creates the next monthly CalVer GitHub Release (YYYY.M.N) from main.
# The workflow tags main and writes notes from src/lib/releases.json; nothing
# is committed, so no deploy is triggered. See D-049 in docs/DECISIONS.md.
#
# Usage: npm run release [-- --dry-run]

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "[dry-run] Would run: gh workflow run release.yml --ref main"
  exit 0
fi

gh workflow run release.yml --ref main
echo "Release started. Follow it with: gh run watch \$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
