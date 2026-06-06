# Cron Job Setup for Newsar

This document explains how to set up automated scheduled tasks for the Newsar platform.

## Entity Summary Generation

Generate AI summaries for trending entities on a regular schedule.

### Recommended Schedule

**Weekly (Sunday at 2 AM):**
```bash
0 2 * * 0 npm run entities:schedule >> /var/log/newsar/entity-summaries.log 2>&1
```

**Daily (2 AM):**
```bash
0 2 * * * cd /var/www/newsar.codejungle.org && npm run entities:schedule 50 >> /var/log/newsar/entity-summaries.log 2>&1
```

### Setup Instructions

1. **Create log directory:**
```bash
sudo mkdir -p /var/log/newsar
sudo chown $USER:$USER /var/log/newsar
```

2. **Edit crontab:**
```bash
crontab -e
```

3. **Add cron entry:**
Choose one of the schedules above and paste it into your crontab.

4. **Verify cron job:**
```bash
crontab -l
```

### Custom Limits

You can specify how many entities to process:

```bash
# Top 30 entities (default)
npm run entities:schedule

# Top 50 entities
npm run entities:schedule 50

# Top 100 entities
npm run entities:schedule 100
```

### Monitoring

**View logs:**
```bash
tail -f /var/log/newsar/entity-summaries.log
```

**Check last run:**
```bash
tail -50 /var/log/newsar/entity-summaries.log
```

**Cron job execution times:**
```bash
grep "entity-summaries" /var/log/syslog
```

## Story Trending Updates

Update trending scores for stories on a regular schedule.

### Recommended Schedule

**Hourly:**
```bash
0 * * * * cd /var/www/newsar.codejungle.org && tsx server/scripts/updateStoryTrending.ts >> /var/log/newsar/story-trending.log 2>&1
```

### Setup

1. Add the cron entry to update story trending scores hourly
2. Monitor logs at `/var/log/newsar/story-trending.log`

## Feed Fetching (Optional)

If not using the auto-pipeline, you can schedule feed fetching:

**Every 30 minutes:**
```bash
*/30 * * * * cd /var/www/newsar.codejungle.org && npm run fetch:all >> /var/log/newsar/feed-fetch.log 2>&1
```

## Cron Schedule Format

```
* * * * * command
│ │ │ │ │
│ │ │ │ └── Day of week (0-7, Sunday=0 or 7)
│ │ │ └──── Month (1-12)
│ │ └────── Day of month (1-31)
│ └──────── Hour (0-23)
└────────── Minute (0-59)
```

### Examples

- `0 2 * * *` - Daily at 2:00 AM
- `0 */6 * * *` - Every 6 hours
- `0 2 * * 0` - Weekly on Sunday at 2:00 AM
- `0 0 1 * *` - Monthly on the 1st at midnight
- `*/15 * * * *` - Every 15 minutes

## Environment Variables

Ensure cron has access to necessary environment variables:

```bash
# Add to crontab before cron entries
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
NODE_ENV=production
DATABASE_URL=postgresql://newsar:***@localhost:5432/newsar
OLLAMA_BASE_URL=https://gotobumnnlizii-11434.proxy.runpod.net
OLLAMA_CHAT_MODEL=qwen2.5:14b-instruct-q5_K_M
```

Or source the environment file:
```bash
0 2 * * 0 cd /var/www/newsar.codejungle.org && source .env && npm run entities:schedule
```

## Troubleshooting

**Cron not running:**
```bash
# Check if cron service is running
sudo systemctl status cron

# Restart cron
sudo systemctl restart cron
```

**Permission issues:**
```bash
# Ensure script is executable
chmod +x /var/www/newsar.codejungle.org/server/scripts/scheduleEntitySummaries.ts
```

**Test manually:**
```bash
cd /var/www/newsar.codejungle.org
npm run entities:schedule
```

## Recommended Setup

For a production Newsar instance, we recommend:

1. **Entity summaries**: Weekly (Sunday 2 AM) for top 50 entities
2. **Story trending**: Hourly
3. **Feed fetching**: Handled by auto-pipeline (no cron needed)

This balances fresh data with system resources.

## PM2 Alternative

Instead of cron, you can use PM2's cron feature in `ecosystem.config.cjs`:

```javascript
{
  name: 'newsar-entity-summaries',
  script: 'server/scripts/scheduleEntitySummaries.ts',
  interpreter: 'tsx',
  cron_restart: '0 2 * * 0', // Weekly on Sunday at 2 AM
  autorestart: false,
  env: {
    NODE_ENV: 'production',
    // ... other env vars
  }
}
```

Then:
```bash
pm2 reload ecosystem.config.cjs
pm2 save
```
