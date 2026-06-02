#!/bin/bash
# Signal Check — Fetch live quotes for top signals and post status to Discord
# Runs at 10:00 AM, 12:00 PM, and 3:30 PM ET on weekdays via cron.
#
# Usage:
#   ./scripts/signal-check.sh

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"

cd "$PROJECT_DIR"

mkdir -p "$LOG_DIR"

echo "[$(date)] Signal check started..." >> "$LOG_DIR/cron.log"

$NODE dist/src/discord-signal-check.js >> "$LOG_DIR/cron.log" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "[$(date)] Signal check FAILED with exit code $EXIT_CODE" >> "$LOG_DIR/cron.log"
else
  echo "[$(date)] Signal check complete." >> "$LOG_DIR/cron.log"
fi

exit $EXIT_CODE
