#!/bin/bash
# Daily V3 scan (all universes) — runs at market open (9:30 AM ET) on weekdays
# Scans all tickers across all universes for trade opportunities
# Universe: all (multi-universe handling delegated to CLI)

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"
UNIVERSE="all"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/scan_all_${TIMESTAMP}.json"
START_TIME=$(date +%s)

echo "[$(date)] Daily scan ($UNIVERSE) started..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

# Run scan with --universe all — CLI handles iterating over all universes internally
$NODE dist/src/cli.js scan --tickers watchlist --strategy v3 --universe $UNIVERSE --allow-stale --summary --log "$LOG_FILE" 2>> "$LOG_DIR/cron.log"

# Signal history upsert per universe (--universe all scan produces merged output,
# but signal-history needs per-universe files)
$NODE dist/src/cli.js signal-history --scan-output "$LOG_FILE" --universe large_cap 2>> "$LOG_DIR/cron.log"
$NODE dist/src/cli.js signal-history --scan-output "$LOG_FILE" --universe mid_cap 2>> "$LOG_DIR/cron.log"

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo "[$(date)] Daily scan ($UNIVERSE) complete. Elapsed: ${ELAPSED}s. Results: $LOG_FILE" >> "$LOG_DIR/cron.log"
