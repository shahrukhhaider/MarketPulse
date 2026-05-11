#!/bin/bash
# Weekly V3 tune — runs Sunday 9:00 AM ET
# Tunes both strategies for top 10 tickers, saves profiles

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"
TICKERS="HOOD SOFI ZETA IREN UNH KTOS ACHR UUUU GRAB NOW"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/tune_${TIMESTAMP}.log"

echo "[$(date)] Running weekly V3 tune..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

for TICKER in $TICKERS; do
  echo "[$(date)] Tuning $TICKER..." >> "$LOG_FILE"
  $NODE dist/src/cli.js v3 --ticker "$TICKER" >> "$LOG_FILE" 2>&1 || echo "[$(date)] $TICKER failed" >> "$LOG_FILE"
done

echo "[$(date)] Weekly tune complete. Log: $LOG_FILE" >> "$LOG_DIR/cron.log"
