# Deploy to Staging

Deploy the current code to the staging environment at https://staging.greengale-app.pages.dev/

## Steps

1. **Build the frontend** with the staging API URL:
   ```bash
   VITE_APPVIEW_URL=https://greengale-staging.asadegroff.workers.dev npm run build
   ```

2. **Deploy the worker** to staging:
   ```bash
   npm run staging:deploy
   ```

3. **Deploy Pages** to the staging branch:
   ```bash
   npx wrangler pages deploy dist --project-name greengale-app --branch staging --commit-dirty=true
   ```

4. **Report the deployment URLs**:
   - Worker: https://greengale-staging.asadegroff.workers.dev
   - Frontend: https://staging.greengale-app.pages.dev

## Notes

- The staging environment uses the same D1 database as production (safe for read operations)
- Staging has its own KV cache namespace and Vectorize index
- No cron triggers run in staging to avoid duplicate firehose consumers
