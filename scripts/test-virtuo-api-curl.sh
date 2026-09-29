#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="${1:-/home/vendetta/hanork/.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"
KEY="${VIRTUO_API_KEY:-}"
if [[ -z "$KEY" ]]; then echo "no key"; exit 1; fi
H=(-H "Authorization: Bearer $KEY")
for url in \
  "https://api.virtuoesim.com/v1/balance" \
  "https://api.virtuoesim.com/v1/prices?service=wa&server=1" \
  "https://api.virtuoesim.com/api/v1/prices?service=wa&server=1" \
  "https://api.virtuoesim.com/v1/services?search=wa&server=1&limit=1"
do
  code=$(curl -s -o /tmp/virtuo-test.json -w "%{http_code}" "${H[@]}" "$url")
  echo "=== $code $url"
  head -c 500 /tmp/virtuo-test.json
  echo
done
