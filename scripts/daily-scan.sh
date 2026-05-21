#!/bin/bash
# Daily V3 scan — runs at market open (9:30 AM ET) on weekdays
# Scans all tickers from watchlist.json for trade opportunities

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/scan_${TIMESTAMP}.json"

echo "[$(date)] Running daily V3 scan..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

# Run scan with --summary flag: prints terminal summary to stdout, saves JSON to log
$NODE dist/src/cli.js scan --tickers watchlist --strategy v3 --allow-stale --summary --log "$LOG_FILE" 2>> "$LOG_DIR/cron.log"

echo "[$(date)] Scan complete. Results: $LOG_FILE" >> "$LOG_DIR/cron.log"

# Update journal — check stop/target hits on open positions
echo "[$(date)] Updating journal outcomes..." >> "$LOG_DIR/cron.log"
$NODE dist/src/cli.js journal-update >> "$LOG_DIR/cron.log" 2>&1 || echo "[$(date)] Journal update failed (exit $?)" >> "$LOG_DIR/cron.log"
