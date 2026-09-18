#!/usr/bin/env bash
# Builds the Android APK (a TWA shell around the PWA).
# The shell almost never changes — the web content inside it updates on every deploy.
# Needs: Java 17+ and Android SDK. Bubblewrap installs the rest itself.
set -euo pipefail
URL="${1:?uso: ./scripts/build-apk.sh https://tuo-worker.workers.dev}"
VER="$(node -p "require('./package.json').version")"

npx @bubblewrap/cli init --manifest "$URL/manifest.json" \
  --directory ./android --chromeosonly false

# start_url carries the shell version so the web app can offer an update.
npx @bubblewrap/cli build --directory ./android

cp ./android/app-release-signed.apk ./public/app.apk
echo "APK -> public/app.apk (v$VER)"
echo "Ora: copia il fingerprint da ./android/android.keystore in public/.well-known/assetlinks.json,"
echo "aggiorna APK_VERSION in wrangler.jsonc, e rideploya."
