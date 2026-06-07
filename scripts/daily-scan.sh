#!/bin/bash
# Daily V3 scan (parameterized) — runs on weekdays per crontab schedule
# Scans all tickers from universe-specific watchlist for trade opportunities
#
# Usage:
#   daily-scan.sh              # defaults to large_cap, scan only (no notification)
#   daily-scan.sh large_cap
#   daily-scan.sh tech
#   daily-scan.sh --notify large_cap
#   daily-scan.sh large_cap --notify

set -e

# --- Parse arguments ---
NOTIFY=false
UNIVERSE="large_cap"

for arg in "$@"; do
  case "$arg" in
    --notify)
      NOTIFY=true
      ;;
    *)
      UNIVERSE="$arg"
      ;;
  esac
done

# Validate universe
case "$UNIVERSE" in
  large_cap|mid_cap|small_cap|tech)
    ;;
  *)
    echo "Error: Unknown universe '$UNIVERSE'. Valid values: large_cap, mid_cap, small_cap, tech" >&2
    exit 1
    ;;
esac

# --- Configuration ---
PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"

# Derive LOG_PREFIX: large_cap → "scan", others → "scan_<universe>"
if [ "$UNIVERSE" = "large_cap" ]; then
  LOG_PREFIX="scan"
else
  LOG_PREFIX="scan_${UNIVERSE}"
fi

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/${LOG_PREFIX}_${TIMESTAMP}.json"
START_TIME=$(date +%s)

echo "[$(date)] Daily scan ($UNIVERSE) started..." >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

# --- Run scan ---
$NODE dist/src/cli.js scan --tickers watchlist --strategy v3 --universe $UNIVERSE --allow-stale --summary --log "$LOG_FILE" 2>> "$LOG_DIR/cron.log"

# --- Signal history upsert ---
$NODE dist/src/cli.js signal-history --scan-output "$LOG_FILE" --universe $UNIVERSE 2>> "$LOG_DIR/cron.log"

# --- Conditional: journal-update (large_cap only) ---
if [ "$UNIVERSE" = "large_cap" ]; then
  $NODE dist/src/cli.js journal-update >> "$LOG_DIR/cron.log" 2>&1
fi

# --- Conditional: Discord notification (when --notify passed and universe-specific webhook file exists) ---
if [ "$NOTIFY" = true ]; then
  WEBHOOK_FILE="$PROJECT_DIR/.stock-tracker/discord-webhook-${UNIVERSE}.txt"
  if [ -f "$WEBHOOK_FILE" ]; then
    WEBHOOK_URL=$(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$WEBHOOK_FILE")
    if [ -n "$WEBHOOK_URL" ]; then
      DISCORD_WEBHOOK_URL="$WEBHOOK_URL" $NODE dist/src/discord-notify.js "$LOG_FILE" 2>> "$LOG_DIR/cron.log" || true
    fi
  fi
fi

# --- Conditional: notify.sh (large_cap only, if script exists and --notify passed) ---
if [ "$UNIVERSE" = "large_cap" ] && [ "$NOTIFY" = true ]; then
  NOTIFY_SCRIPT="$PROJECT_DIR/scripts/notify.sh"
  if [ -f "$NOTIFY_SCRIPT" ]; then
    "$NOTIFY_SCRIPT" "$LOG_FILE" 2>> "$LOG_DIR/cron.log" || true
  fi
fi

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo "[$(date)] Daily scan ($UNIVERSE) complete. Elapsed: ${ELAPSED}s. Results: $LOG_FILE" >> "$LOG_DIR/cron.log"
