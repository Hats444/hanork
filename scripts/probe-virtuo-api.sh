#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="${1:-/home/vendetta/hanork/.env}"
KEY=$(grep ^VIRTUO_API_KEY= "$ENV_FILE" | head -1 | cut -d= -f2-)
H=(-H "Authorization: Bearer $KEY" -H "X-Api-Key: $KEY" -H "Content-Type: application/json")
BODY='{"service":"wa","country":16,"server":1,"maxPrice":10}'

probe() {
  local method="$1" url="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    code=$(curl -s -o /tmp/vp.out -w "%{http_code}" -X "$method" "${H[@]}" -d "$body" "$url")
  else
    code=$(curl -s -o /tmp/vp.out -w "%{http_code}" -X "$method" "${H[@]}" "$url")
  fi
  echo "=== $code $method $url"
  head -c 300 /tmp/vp.out
  echo -e "\n"
}

for base in \
  "https://api.virtuoesim.com/v1" \
  "https://api.virtuoesim.com/api/v1" \
  "https://sms.virtuoesim.com/api/v1" \
  "https://sms.virtuoesim.com/v1"
do
  probe GET  "$base/balance"
  probe POST "$base/activation/request" "$BODY"
done

probe GET "https://api.virtuoesim.com/v1/services?search=wa&server=1&limit=1"
