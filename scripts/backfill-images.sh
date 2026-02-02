#!/bin/bash

# Backfill first_image_cid for posts that don't have it
# Usage: ./backfill-images.sh

set -e

ADMIN_SECRET="${ADMIN_SECRET:-}"
LIMIT=100
TOTAL_PROCESSED=0

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable is required"
  echo "Usage: ADMIN_SECRET=your-secret ./backfill-images.sh"
  exit 1
fi

BASE_URL="https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.backfillFirstImageCid"

echo "Starting first image CID backfill..."
echo ""

while true; do
  echo "---"
  echo "Processing batch..."

  RESPONSE=$(curl -s -X POST "${BASE_URL}" \
    -H "X-Admin-Secret: $ADMIN_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"limit\": $LIMIT}")

  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  if [ -n "$ERROR" ]; then
    echo "Error: $ERROR"
    echo "$RESPONSE" | jq -r '.details // empty'
    exit 1
  fi

  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed // 0')
  UPDATED=$(echo "$RESPONSE" | jq -r '.updated // 0')

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))

  echo "Processed: $PROCESSED, Updated: $UPDATED (Total processed: $TOTAL_PROCESSED)"

  if [ "$PROCESSED" -eq 0 ] 2>/dev/null || [ "$PROCESSED" = "null" ]; then
    echo ""
    echo "==="
    echo "Done! Total processed: $TOTAL_PROCESSED"
    break
  fi

  sleep 1
done
