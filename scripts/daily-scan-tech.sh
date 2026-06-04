#!/bin/bash
# Daily V3 scan (tech) — runs at 16:45 ET on weekdays (after large_cap at 16:30)
# Scans all tickers from watchlist-tech.json for trade opportunities
# Universe: tech

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"
UNIVERSE="tech"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/scan_tech_${TIMESTAMP}.json"
START_TIME=$(date +%s)

echo "[$(date)] Daily scan ($UNIVERSE) started..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

# Run scan with --universe tech
$NODE dist/src/cli.js scan --tickers watchlist --strategy v3 --universe $UNIVERSE --allow-stale --summary --log "$LOG_FILE" 2>> "$LOG_DIR/cron.log"

# Signal history upsert with --universe tech
$NODE dist/src/cli.js signal-history --scan-output "$LOG_FILE" --universe $UNIVERSE 2>> "$LOG_DIR/cron.log"

# Discord notification — read tech webhook; skip if missing/empty
WEBHOOK_FILE="$PROJECT_DIR/.stock-tracker/discord-webhook-tech.txt"
if [ -f "$WEBHOOK_FILE" ]; then
  WEBHOOK_URL=$(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$WEBHOOK_FILE")
  if [ -n "$WEBHOOK_URL" ]; then
    DISCORD_WEBHOOK_URL="$WEBHOOK_URL" $NODE dist/src/discord-notify.js "$LOG_FILE" 2>> "$LOG_DIR/cron.log" || true
  fi
fi

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo "[$(date)] Daily scan ($UNIVERSE) complete. Elapsed: ${ELAPSED}s. Results: $LOG_FILE" >> "$LOG_DIR/cron.log"
