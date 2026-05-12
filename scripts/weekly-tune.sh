#!/bin/bash
# Weekly V3 tune — runs Sunday 9:00 AM ET
# Tunes all top100 tickers in parallel using built-in worker pool

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/tune_${TIMESTAMP}.log"

echo "[$(date)] Running weekly V3 tune..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

# Run parallel tune-pipeline with top100 tickers and 8 concurrent workers
# Single invocation replaces the sequential per-ticker loop
if $NODE dist/src/cli.js tune-pipeline --tickers top100 --strategy v3 --concurrency 8 --save >> "$LOG_FILE" 2>&1; then
  echo "[$(date)] Weekly tune complete. Log: $LOG_FILE" >> "$LOG_DIR/cron.log"
else
  EXIT_CODE=$?
  echo "[$(date)] Weekly tune FAILED (exit code $EXIT_CODE). Log: $LOG_FILE" >> "$LOG_DIR/cron.log"
  exit $EXIT_CODE
fi
