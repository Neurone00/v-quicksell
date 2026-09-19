#!/usr/bin/env bash
# Publish the extension as a versioned GitHub Release.
# To ship a new version: bump "version" in extension/manifest.json, update
# RELEASE.md, then `npm run release`.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./extension/manifest.json').version")
TAG="v$VER"
OUT="quicksell-extension-$VER.zip"

# The repo is public. Refuse to ship anything that looks like a credential.
if grep -rEn "(APP_SECRET|GEMINI_API_KEY|VAPID_JWK)\s*[:=]\s*['\"][^'\"]{8,}|k=[0-9a-f]{40,}" extension/ ; then
  echo "refusing: secret-looking string in extension/" >&2; exit 1
fi
if [ -n "$(git status --porcelain)" ]; then echo "refusing: uncommitted changes — commit first so the tag is real" >&2; exit 1; fi

rm -f "$OUT"
(cd extension && zip -q -r "../$OUT" manifest.json background.js content.js popup.html popup.js icon.png)
gh release create "$TAG" "$OUT" --title "Quicksell $VER" --notes-file RELEASE.md
rm -f "$OUT"
gh release view "$TAG" --json url --jq .url
