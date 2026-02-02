#!/bin/bash

# Expand content previews for posts truncated at ~300 chars
# Runs in a loop until no more posts need processing

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable not set"
  exit 1
fi

API_URL="${API_URL:-https://greengale-staging.asadegroff.workers.dev}"
LIMIT="${LIMIT:-500}"
MIN_LENGTH="${MIN_LENGTH:-295}"
THRESHOLD="${THRESHOLD:-305}"
CONCURRENCY="${CONCURRENCY:-50}"
SKIP_RECENT="${SKIP_RECENT:-5}"

echo "Expanding content previews..."
echo "API: $API_URL"
echo "Params: limit=$LIMIT, minLength=$MIN_LENGTH, threshold=$THRESHOLD, concurrency=$CONCURRENCY, skipRecentMinutes=$SKIP_RECENT"
echo ""

while true; do
  result=$(curl -s -X POST "$API_URL/xrpc/app.greengale.admin.expandContentPreviews?limit=$LIMIT&minLength=$MIN_LENGTH&threshold=$THRESHOLD&concurrency=$CONCURRENCY&skipRecentMinutes=$SKIP_RECENT" \
    -H "X-Admin-Secret: $ADMIN_SECRET")

  echo "$result" | jq '{processed, failed, remaining}'

  remaining=$(echo "$result" | jq -r '.remaining // 0')

  if [ "$remaining" -eq 0 ]; then
    echo ""
    echo "Done! No more posts to process."
    break
  fi

  sleep 2  # Brief pause between batches
done
