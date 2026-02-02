#!/bin/bash

# Backfill site.standard.publication records (Leaflet, Blento, etc.)
# Usage: ./backfill-publications.sh [url_filter]
# Examples:
#   ./backfill-publications.sh leaflet.pub
#   ./backfill-publications.sh blento.app
#   ./backfill-publications.sh              # all platforms

set -e

# Configuration
ADMIN_SECRET="${ADMIN_SECRET:-}"
URL_FILTER="${1:-}"
LIMIT=50
CURSOR=""
TOTAL_INDEXED=0

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable is required"
  echo "Usage: ADMIN_SECRET=your-secret ./backfill-publications.sh [url_filter]"
  exit 1
fi

BASE_URL="https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.discoverSiteStandardPublications"

echo "Starting backfill..."
[ -n "$URL_FILTER" ] && echo "Filtering for: $URL_FILTER" || echo "No URL filter (all platforms)"
echo ""

while true; do
  echo "---"
  echo "Fetching batch (cursor: ${CURSOR:-(start)})..."

  # Build URL with parameters
  ENDPOINT="${BASE_URL}?limit=${LIMIT}"
  [ -n "$URL_FILTER" ] && ENDPOINT="${ENDPOINT}&urlFilter=${URL_FILTER}"
  [ -n "$CURSOR" ] && ENDPOINT="${ENDPOINT}&cursor=${CURSOR}"

  RESPONSE=$(curl -s -X POST "$ENDPOINT" -H "X-Admin-Secret: $ADMIN_SECRET")

  # Check for errors
  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  if [ -n "$ERROR" ]; then
    echo "Error: $ERROR"
    echo "$RESPONSE" | jq -r '.details // empty'
    exit 1
  fi

  # Parse response
  DISCOVERED=$(echo "$RESPONSE" | jq -r '.discovered')
  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed')
  INDEXED=$(echo "$RESPONSE" | jq -r '.indexed')
  CURSOR=$(echo "$RESPONSE" | jq -r '.cursor // empty')

  TOTAL_INDEXED=$((TOTAL_INDEXED + INDEXED))

  echo "Discovered: $DISCOVERED, Processed: $PROCESSED, Indexed: $INDEXED (Total: $TOTAL_INDEXED)"

  # Show any indexed publications
  echo "$RESPONSE" | jq -r '.publications[]? | select(.status == "indexed") | "  + \(.handle // .did) - \(.name // "unnamed")"'

  # Check if we're done (no cursor means relay exhausted)
  if [ -z "$CURSOR" ] || [ "$CURSOR" = "null" ]; then
    echo ""
    echo "==="
    echo "Done! Total indexed: $TOTAL_INDEXED"
    break
  fi

  sleep 1
done
