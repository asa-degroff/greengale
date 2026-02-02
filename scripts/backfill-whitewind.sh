#!/bin/bash

# Discover and backfill WhiteWind authors
# Usage: ./backfill-whitewind.sh [--dry-run]

set -e

ADMIN_SECRET="${ADMIN_SECRET:-}"
DRY_RUN=""
[ "$1" = "--dry-run" ] && DRY_RUN="&dryRun=true"

LIMIT=50
CURSOR=""
TOTAL_INDEXED=0

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable is required"
  echo "Usage: ADMIN_SECRET=your-secret ./backfill-whitewind.sh [--dry-run]"
  exit 1
fi

BASE_URL="https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.discoverWhiteWindAuthors"

echo "Starting WhiteWind author discovery..."
[ -n "$DRY_RUN" ] && echo "(Dry run mode)"
echo ""

while true; do
  echo "---"
  echo "Fetching batch (cursor: ${CURSOR:-(start)})..."

  ENDPOINT="${BASE_URL}?limit=${LIMIT}${DRY_RUN}"
  [ -n "$CURSOR" ] && ENDPOINT="${ENDPOINT}&cursor=${CURSOR}"

  RESPONSE=$(curl -s -X POST "$ENDPOINT" -H "X-Admin-Secret: $ADMIN_SECRET")

  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  if [ -n "$ERROR" ]; then
    echo "Error: $ERROR"
    echo "$RESPONSE" | jq -r '.details // empty'
    exit 1
  fi

  DISCOVERED=$(echo "$RESPONSE" | jq -r '.discovered')
  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed')
  POSTS_INDEXED=$(echo "$RESPONSE" | jq -r '.totalPostsIndexed')
  CURSOR=$(echo "$RESPONSE" | jq -r '.cursor // empty')

  TOTAL_INDEXED=$((TOTAL_INDEXED + POSTS_INDEXED))

  echo "Discovered: $DISCOVERED, Processed: $PROCESSED, Posts indexed: $POSTS_INDEXED (Total: $TOTAL_INDEXED)"

  echo "$RESPONSE" | jq -r '.authors[]? | select(.postsIndexed > 0) | "  + \(.handle // .did): \(.postsIndexed) posts"'

  if [ -z "$CURSOR" ] || [ "$CURSOR" = "null" ]; then
    echo ""
    echo "==="
    echo "Done! Total posts indexed: $TOTAL_INDEXED"
    break
  fi

  sleep 1
done
