#!/bin/bash

# Backfill tags for posts that don't have them extracted
# Usage: ./backfill-tags.sh

set -e

ADMIN_SECRET="${ADMIN_SECRET:-}"
LIMIT=100
TOTAL_PROCESSED=0

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable is required"
  echo "Usage: ADMIN_SECRET=your-secret ./backfill-tags.sh"
  exit 1
fi

BASE_URL="https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.backfillTags"

echo "Starting tags backfill..."
echo ""

while true; do
  echo "---"
  echo "Processing batch..."

  RESPONSE=$(curl -s -X POST "${BASE_URL}?limit=${LIMIT}" -H "X-Admin-Secret: $ADMIN_SECRET")

  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  if [ -n "$ERROR" ]; then
    echo "Error: $ERROR"
    echo "$RESPONSE" | jq -r '.details // empty'
    exit 1
  fi

  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed // 0')
  TAGS_ADDED=$(echo "$RESPONSE" | jq -r '.tagsAdded // 0')

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))

  echo "Processed: $PROCESSED, Tags added: $TAGS_ADDED (Total processed: $TOTAL_PROCESSED)"

  if [ "$PROCESSED" -eq 0 ] 2>/dev/null || [ "$PROCESSED" = "null" ]; then
    echo ""
    echo "==="
    echo "Done! Total processed: $TOTAL_PROCESSED"
    break
  fi

  sleep 1
done
