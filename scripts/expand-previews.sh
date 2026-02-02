#!/bin/bash

# Expand content previews that were truncated at old limits
# Re-indexes posts to get full 3000-char previews
# Usage: ./expand-previews.sh [--threshold=1000] [--min-length=250] [--concurrency=10]

set -e

ADMIN_SECRET="${ADMIN_SECRET:-}"
LIMIT=100
THRESHOLD=1000
MIN_LENGTH=250
CONCURRENCY=10
TOTAL_PROCESSED=0
TOTAL_FAILED=0

# Parse arguments
for arg in "$@"; do
  case $arg in
    --threshold=*)
      THRESHOLD="${arg#*=}"
      ;;
    --min-length=*)
      MIN_LENGTH="${arg#*=}"
      ;;
    --concurrency=*)
      CONCURRENCY="${arg#*=}"
      ;;
  esac
done

if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable is required"
  echo "Usage: ADMIN_SECRET=your-secret ./expand-previews.sh [--threshold=1000] [--min-length=250] [--concurrency=10]"
  echo ""
  echo "Options:"
  echo "  --threshold=N   Max preview length to consider (default: 1000)"
  echo "  --min-length=N  Min preview length to consider (default: 250)"
  echo "  --concurrency=N Parallel requests per batch (default: 10, max: 20)"
  exit 1
fi

BASE_URL="https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.expandContentPreviews"

echo "Expanding content previews..."
echo "  Threshold: $THRESHOLD chars"
echo "  Min length: $MIN_LENGTH chars"
echo "  Concurrency: $CONCURRENCY"
echo ""

while true; do
  echo "---"
  echo "Processing batch..."

  RESPONSE=$(curl -s -X POST "${BASE_URL}?limit=${LIMIT}&threshold=${THRESHOLD}&minLength=${MIN_LENGTH}&concurrency=${CONCURRENCY}" \
    -H "X-Admin-Secret: $ADMIN_SECRET")

  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  if [ -n "$ERROR" ]; then
    echo "Error: $ERROR"
    echo "$RESPONSE" | jq -r '.details // empty'
    exit 1
  fi

  TOTAL=$(echo "$RESPONSE" | jq -r '.total // 0')
  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed // 0')
  FAILED=$(echo "$RESPONSE" | jq -r '.failed // 0')

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))

  echo "Found: $TOTAL, Processed: $PROCESSED, Failed: $FAILED (Total: $TOTAL_PROCESSED processed, $TOTAL_FAILED failed)"

  # Show any errors
  echo "$RESPONSE" | jq -r '.errors[]? | "  ! \(.)"'

  if [ "$TOTAL" -eq 0 ] 2>/dev/null || [ "$TOTAL" = "null" ]; then
    echo ""
    echo "==="
    echo "Done! Total processed: $TOTAL_PROCESSED, Total failed: $TOTAL_FAILED"
    break
  fi

  sleep 1
done
