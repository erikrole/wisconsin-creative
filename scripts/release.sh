#!/usr/bin/env bash
set -euo pipefail

# Release script for Wisconsin Creative
# Usage: npm run release [-- --dry-run] [-- --yes]
#
# Creates a CalVer tag (YYYY.M.N) and updates package.json + package-lock.json.
# GitHub Actions turns the pushed tag into a GitHub Release with generated notes.
#
# Flags:
#   --dry-run   Show what would happen without creating anything
#   --yes       Skip confirmation prompts (for automated use)

DRY_RUN=false
AUTO_YES=false
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --yes|-y) AUTO_YES=true ;;
  esac
done

# Ensure working directory is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory is not clean. Commit or stash changes first."
  exit 1
fi

# Ensure we're on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Warning: Not on main branch (currently on '$BRANCH')."
  if [ "$AUTO_YES" = false ]; then
    read -rp "Continue anyway? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  fi
fi

# Calculate this month's CalVer tag. The final component is the release number
# within the month: 2026.8.1, 2026.8.2, and so on.
YEAR=$(date +%Y)
MONTH=$(date +%m)
MONTH=${MONTH#0}
EXISTING=$(git tag -l "${YEAR}.${MONTH}.*" | awk -F. 'NF == 3 && $3 ~ /^[0-9]+$/ { print }' | sort -t. -k3,3n | tail -1)

if [ -z "$EXISTING" ]; then
  RELEASE_NUMBER=1
else
  LAST_RELEASE_NUMBER=$(echo "$EXISTING" | awk -F. '{print $3}')
  RELEASE_NUMBER=$((LAST_RELEASE_NUMBER + 1))
fi

VERSION="${YEAR}.${MONTH}.${RELEASE_NUMBER}"

echo "Release: ${VERSION}"
echo ""

# Show what's new since the last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  echo "Changes since ${LAST_TAG}:"
  git log --oneline "${LAST_TAG}..HEAD"
else
  echo "First release — all commits included."
  git log --oneline -20
fi
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "[dry-run] Would create tag: ${VERSION}"
  echo "[dry-run] Would update package.json and package-lock.json to: ${VERSION}"
  echo "[dry-run] Would push main and the tag; GitHub Actions would create the GitHub Release"
  exit 0
fi

if [ "$AUTO_YES" = false ]; then
  read -rp "Create release ${VERSION}? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Update package.json and package-lock.json versions
if command -v node &>/dev/null; then
  VERSION="${VERSION}" node -e "
    const fs = require('fs');
    const version = process.env.VERSION;
    for (const file of ['package.json', 'package-lock.json']) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      pkg.version = version;
      if (pkg.packages && pkg.packages['']) pkg.packages[''].version = version;
      fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    }
  "
  git add package.json package-lock.json
  git commit -m "chore: release ${VERSION}"
fi

# Create annotated tag
git tag -a "${VERSION}" -m "Release ${VERSION}"

# Push commit + tag
git push origin "${BRANCH}"
git push origin "${VERSION}"

echo ""
echo "Released ${VERSION}"
echo ""
echo "GitHub Actions will create the GitHub Release from tag ${VERSION}."
