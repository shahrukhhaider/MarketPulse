#!/bin/bash
# Daily V3 scan (mid-cap) — runs at market open (9:30 AM ET) on weekdays
# Scans all tickers from watchlist-midcap.json for trade opportunities
# Universe: mid_cap

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"
UNIVERSE="mid_cap"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/scan_midcap_${TIMESTAMP}.json"
START_TIME=$(date +%s)

echo "[$(date)] Daily scan ($UNIVERSE) started..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

# Run scan with --universe mid_cap
$NODE dist/src/cli.js scan --tickers watchlist --strategy v3 --universe $UNIVERSE --allow-stale --summary --log "$LOG_FILE" 2>> "$LOG_DIR/cron.log"

# Signal history upsert with --universe mid_cap
$NODE dist/src/cli.js signal-history --scan-output "$LOG_FILE" --universe $UNIVERSE 2>> "$LOG_DIR/cron.log"

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo "[$(date)] Daily scan ($UNIVERSE) complete. Elapsed: ${ELAPSED}s. Results: $LOG_FILE" >> "$LOG_DIR/cron.log"
