# Semantic Search Deployment Guide

This guide covers deploying the semantic search feature to staging and production.

## Prerequisites

- Cloudflare account with Workers, D1, KV, Vectorize, and Workers AI access
- Wrangler CLI installed and authenticated (`npx wrangler login`)

## Staging Deployment

### Step 1: Create Staging Resources

```bash
# Create staging KV namespace
npx wrangler kv namespace create CACHE --env staging

# Output will show the namespace ID - update wrangler.toml with it
# Replace STAGING_KV_ID_PLACEHOLDER with the actual ID
```

```bash
# Create staging Vectorize index
npx wrangler vectorize create greengale-posts-staging --dimensions=1024 --metric=cosine
```

### Step 2: Run Database Migration

The migration adds new columns for embedding tracking. It's safe to run on production since it only adds columns with defaults.

```bash
# Run the semantic search migration
npx wrangler d1 execute greengale --remote --file=./workers/migrations/014_semantic_search.sql
```

### Step 3: Set Admin Secret for Staging

```bash
npx wrangler secret put ADMIN_SECRET --env staging
# Enter a secure random string when prompted
```

### Step 4: Deploy to Staging

```bash
npm run staging:deploy
```

The staging worker will be available at:
`https://greengale-staging.<your-subdomain>.workers.dev`

### Step 5: Verify Staging Deployment

```bash
# Check health
curl https://greengale-staging.<subdomain>.workers.dev/xrpc/_health

# Check embedding stats (should show all zeros initially)
curl -H "X-Admin-Secret: YOUR_SECRET" \
  https://greengale-staging.<subdomain>.workers.dev/xrpc/app.greengale.admin.getEmbeddingStats

# Test search endpoint (will return empty until backfill)
curl "https://greengale-staging.<subdomain>.workers.dev/xrpc/app.greengale.search.posts?q=test"
```

### Step 6: Start Firehose on Staging

```bash
curl -X POST -H "X-Admin-Secret: YOUR_SECRET" \
  https://greengale-staging.<subdomain>.workers.dev/xrpc/app.greengale.admin.startFirehose
```

### Step 7: Backfill Existing Posts (Dry Run First)

```bash
# Preview what would be processed
curl -X POST -H "X-Admin-Secret: YOUR_SECRET" \
  "https://greengale-staging.<subdomain>.workers.dev/xrpc/app.greengale.admin.backfillEmbeddings?limit=10&dryRun=true"

# Run actual backfill in batches
curl -X POST -H "X-Admin-Secret: YOUR_SECRET" \
  "https://greengale-staging.<subdomain>.workers.dev/xrpc/app.greengale.admin.backfillEmbeddings?limit=50"
```

### Step 8: Test Semantic Search

```bash
# Test hybrid search
curl "https://greengale-staging.<subdomain>.workers.dev/xrpc/app.greengale.search.posts?q=your+search+term"

# Test semantic-only search
curl "https://greengale-staging.<subdomain>.workers.dev/xrpc/app.greengale.search.posts?q=your+search+term&mode=semantic"

# Test similar posts
curl "https://greengale-staging.<subdomain>.workers.dev/xrpc/app.greengale.feed.getSimilarPosts?uri=at://did:plc:example/app.greengale.document/abc123"
```

---

## Production Deployment

Only proceed after staging is verified working.

### Step 1: Create Production Vectorize Index

```bash
npx wrangler vectorize create greengale-posts --dimensions=1024 --metric=cosine
```

### Step 2: Verify Migration Already Applied

The migration should already be applied from staging testing. Verify:

```bash
npx wrangler d1 execute greengale --remote --command "PRAGMA table_info(posts);" | grep has_embedding
```

If not present, run the migration:
```bash
npx wrangler d1 execute greengale --remote --file=./workers/migrations/014_semantic_search.sql
```

### Step 3: Deploy to Production

```bash
npm run deploy
```

### Step 4: Backfill Production Posts

Run backfill in batches to avoid rate limits:

```bash
# Check current stats
curl -H "X-Admin-Secret: $ADMIN_SECRET" \
  https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.getEmbeddingStats

# Backfill in batches of 50, wait between batches
for i in {1..20}; do
  echo "Batch $i..."
  curl -X POST -H "X-Admin-Secret: $ADMIN_SECRET" \
    "https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.backfillEmbeddings?limit=50"
  echo ""
  sleep 5  # Wait 5 seconds between batches
done
```

---

## Monitoring

### Check Embedding Progress

```bash
curl -H "X-Admin-Secret: $ADMIN_SECRET" \
  https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.getEmbeddingStats
```

Response:
```json
{
  "total": 1000,
  "embedded": 850,
  "pending": 100,
  "skipped": 45,
  "failed": 5,
  "softDeleted": 0
}
```

- `embedded`: Posts with embeddings
- `pending`: Posts awaiting embedding (public, not deleted, has_embedding=0)
- `skipped`: Posts too short for embedding (has_embedding=-1)
- `failed`: Posts that failed embedding (has_embedding=-2), will retry on next backfill

### View Worker Logs

```bash
# Production
npm run worker:tail

# Staging
npm run staging:tail
```

---

## Rollback

If issues occur, the semantic search is isolated and can be disabled:

1. **Frontend**: Don't deploy search UI until verified
2. **API**: Search endpoints will return empty results if Vectorize is unavailable
3. **Firehose**: Embedding generation is async and won't block post indexing

To fully rollback:
```bash
# Revert to previous worker version
git checkout HEAD~1 -- workers/
npm run worker:deploy
```

---

## Cost Estimates

### Workers AI (Embeddings)
- Free tier: 10,000 neurons/day (~100 embeddings/day)
- Beyond free: $0.011 per 1,000 neurons

### Vectorize
- Free tier: 30M queried dimensions/month, 5M stored dimensions/month
- Each query: 1,024 dimensions × topK
- Each stored post: 1,024 dimensions (or 1,024 × chunks for long posts)

### Estimated Monthly Cost
- ~5,000 posts stored: Free
- ~30,000 search queries: Free
- Beyond free tier: ~$0.01-0.05/month
