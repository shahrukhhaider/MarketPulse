#!/bin/bash
# Daily V3 scan — runs at market open (9:30 AM ET) on weekdays
# Scans top 10 tickers for trade opportunities using both strategies

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"
TICKERS="HOOD,SOFI,ZETA,IREN,UNH,KTOS,ACHR,UUUU,GRAB,NOW"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/scan_${TIMESTAMP}.json"

echo "[$(date)] Running daily V3 scan..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"
$NODE dist/src/cli.js scan --tickers "$TICKERS" --strategy v3 --allow-stale > "$LOG_FILE" 2>> "$LOG_DIR/cron.log"

echo "[$(date)] Scan complete. Results: $LOG_FILE" >> "$LOG_DIR/cron.log"
