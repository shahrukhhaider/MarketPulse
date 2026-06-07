#!/bin/bash
# Morning sentiment digest — fetches StockTwits + news for active/near tickers
#
# Usage:
#   sentiment-digest.sh              # dry-run: prints digest to terminal, no Discord post
#   sentiment-digest.sh --notify     # posts digest to Discord webhook
#   sentiment-digest.sh --universe tech              # tech universe, dry-run
#   sentiment-digest.sh --universe tech --notify     # tech universe, posts to Discord

set -e

# --- Parse arguments ---
NOTIFY=false
UNIVERSE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notify)
      NOTIFY=true
      shift
      ;;
    --universe)
      UNIVERSE="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown argument '$1'" >&2
      echo "Usage: sentiment-digest.sh [--notify] [--universe large_cap|tech]" >&2
      exit 1
      ;;
  esac
done

# --- Configuration ---
PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"

mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"

# --- Build CLI args ---
CLI_ARGS="sentiment-check"

if [ -n "$UNIVERSE" ]; then
  CLI_ARGS="$CLI_ARGS --universe $UNIVERSE"
fi

if [ "$NOTIFY" = false ]; then
  CLI_ARGS="$CLI_ARGS --dry-run"
fi

# --- Run ---
if [ "$NOTIFY" = true ]; then
  # When notifying, need the webhook URL
  WEBHOOK_FILE="$PROJECT_DIR/.stock-tracker/discord-webhook-sentiment.txt"
  if [ -f "$WEBHOOK_FILE" ]; then
    WEBHOOK_URL=$(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$WEBHOOK_FILE")
  fi

  if [ -z "$WEBHOOK_URL" ] && [ -n "$DISCORD_WEBHOOK_URL" ]; then
    WEBHOOK_URL="$DISCORD_WEBHOOK_URL"
  fi

  if [ -z "$WEBHOOK_URL" ]; then
    echo "Error: No webhook URL found. Set DISCORD_WEBHOOK_URL or create .stock-tracker/discord-webhook-sentiment.txt" >&2
    exit 1
  fi

  DISCORD_WEBHOOK_URL="$WEBHOOK_URL" $NODE dist/src/cli.js $CLI_ARGS
else
  $NODE dist/src/cli.js $CLI_ARGS
fi
