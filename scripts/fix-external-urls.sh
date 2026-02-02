#!/bin/bash

# Fix site.standard.document posts missing external URLs
# Runs in a loop until no more posts need processing

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable not set"
  exit 1
fi

API_URL="${API_URL:-https://greengale-staging.asadegroff.workers.dev}"
LIMIT="${LIMIT:-100}"
CONCURRENCY="${CONCURRENCY:-20}"

echo "Fixing missing external URLs..."
echo "API: $API_URL"
echo "Params: limit=$LIMIT, concurrency=$CONCURRENCY"
echo ""

while true; do
  result=$(curl -s -X POST "$API_URL/xrpc/app.greengale.admin.fixMissingExternalUrls?limit=$LIMIT&concurrency=$CONCURRENCY" \
    -H "X-Admin-Secret: $ADMIN_SECRET")

  echo "$result" | jq '{processed, fixed, failed, remaining}'

  remaining=$(echo "$result" | jq -r '.remaining // 0')

  if [ "$remaining" -eq 0 ]; then
    echo ""
    echo "Done! No more posts to process."
    break
  fi

  sleep 2  # Brief pause between batches
done
