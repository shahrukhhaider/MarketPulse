#!/bin/bash
# Daily V3 scan — runs at market open (9:30 AM ET) on weekdays
# Scans top 20 tickers for trade opportunities using both strategies

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"
TICKERS="AAPL,MSFT,GOOGL,AMZN,NVDA,META,TSLA,JPM,HOOD,SOFI,ZETA,IREN,UNH,KTOS,ACHR,UUUU,GRAB,NOW,JNJ,NFLX"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/scan_${TIMESTAMP}.json"

echo "[$(date)] Running daily V3 scan..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

# Save JSON to log file
$NODE dist/src/cli.js scan --tickers "$TICKERS" --strategy v3 --allow-stale > "$LOG_FILE" 2>> "$LOG_DIR/cron.log"

# Print terminal summary
$NODE dist/src/cli.js scan --tickers "$TICKERS" --strategy v3 --allow-stale --summary 2>/dev/null

echo "[$(date)] Scan complete. Results: $LOG_FILE" >> "$LOG_DIR/cron.log"
