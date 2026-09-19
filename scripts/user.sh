#!/usr/bin/env bash
# npm run user -- add <name>   mint a login link for another person or a test setup
# npm run user -- list         who exists
set -euo pipefail
cd "$(dirname "$0")/.."
K=$(grep '^APP_SECRET=' .dev.vars | cut -d= -f2)
URL=$(grep -oE '"PUBLIC_URL": *"[^"]+"' wrangler.jsonc | sed -E 's/.*"([^"]+)"$/\1/')
case "${1:-}" in
  add)
    curl -sf -X POST "$URL/api/users?k=$K" -H 'content-type: application/json' -d "{\"name\":\"${2:?nome mancante}\"}" \
    | python3 -c '
import json, sys
d = json.load(sys.stdin)
if d.get("error"):
    print(d["error"]); sys.exit(1)
print()
print("utente:", d["name"])
print("apri questo link una volta sul dispositivo; la stessa chiave va nella estensione:")
print(d["url"])
print()' ;;
  list) curl -sf "$URL/api/users?k=$K"; echo ;;
  *) echo "uso: npm run user -- add <nome> | list" >&2; exit 1 ;;
esac
