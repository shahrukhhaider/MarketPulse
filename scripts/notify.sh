#!/bin/bash
# Notify — Post latest scan results to Discord
# Separate from scanning so egress can be triggered independently.
#
# Usage:
#   ./scripts/notify.sh              # posts latest scan log
#   ./scripts/notify.sh <path.json>  # posts specific scan log

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"

cd "$PROJECT_DIR"

if [ -n "$1" ]; then
  $NODE dist/src/discord-notify.js "$1"
else
  $NODE dist/src/discord-notify.js
fi
