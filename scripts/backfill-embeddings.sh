#!/bin/bash

# Backfill embeddings for posts that don't have them
# Usage: ./backfill-embeddings.sh

set -e

ADMIN_SECRET="${ADMIN_SECRET:-}"
LIMIT=50
TOTAL_PROCESSED=0

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable is required"
  echo "Usage: ADMIN_SECRET=your-secret ./backfill-embeddings.sh"
  exit 1
fi

BASE_URL="https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.backfillEmbeddings"

echo "Starting embeddings backfill..."
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
  REMAINING=$(echo "$RESPONSE" | jq -r '.remaining // 0')

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))

  echo "Processed: $PROCESSED, Remaining: $REMAINING (Total processed: $TOTAL_PROCESSED)"

  if [ "$PROCESSED" -eq 0 ] 2>/dev/null || [ "$REMAINING" -eq 0 ] 2>/dev/null || [ "$PROCESSED" = "null" ]; then
    echo ""
    echo "==="
    echo "Done! Total processed: $TOTAL_PROCESSED"
    break
  fi

  sleep 2
done
