#!/bin/bash
# Weekly V3 tune — parameterized for all universes
# Usage: weekly-tune.sh [universe]
#   universe: large_cap (default), mid_cap, small_cap, tech
# Tunes all tickers from the universe watchlist in batches with progress updates.
# Uses built-in parallel worker pool (8 concurrent) per batch.

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"
BATCH_SIZE=50
CONCURRENCY=8

# --- Universe resolution ---
UNIVERSE="${1:-large_cap}"

# Validate universe against known values
case "$UNIVERSE" in
  large_cap|mid_cap|small_cap|tech)
    ;;
  *)
    echo "ERROR: Unknown universe '$UNIVERSE'. Valid values: large_cap, mid_cap, small_cap, tech" >&2
    exit 1
    ;;
esac

# Resolve watchlist file path based on universe
case "$UNIVERSE" in
  large_cap)  WATCHLIST_FILE=".stock-tracker/data/watchlist.json" ;;
  tech)       WATCHLIST_FILE=".stock-tracker/data/watchlist-tech.json" ;;
  mid_cap)    WATCHLIST_FILE=".stock-tracker/data/watchlist-midcap.json" ;;
  small_cap)  WATCHLIST_FILE=".stock-tracker/data/watchlist-smallcap.json" ;;
esac

# Derive LOG_PREFIX: large_cap → tune, others → tune_<universe>
if [ "$UNIVERSE" = "large_cap" ]; then
  LOG_PREFIX="tune"
  DISPLAY_LABEL="Weekly Tune"
else
  LOG_PREFIX="tune_${UNIVERSE}"
  DISPLAY_LABEL="Weekly Tune (${UNIVERSE})"
fi

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/${LOG_PREFIX}_${TIMESTAMP}.log"

cd "$PROJECT_DIR"

# --- Watchlist validation (applied to ALL universes) ---
if [ ! -f "$WATCHLIST_FILE" ]; then
  echo "[$(date)] ERROR: Watchlist file not found: $WATCHLIST_FILE" | tee -a "$LOG_FILE"
  exit 1
fi

# Load all tickers from watchlist
ALL_TICKERS=$($NODE -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('$WATCHLIST_FILE', 'utf-8'));
  if (!data.tickers || data.tickers.length === 0) {
    process.exit(1);
  }
  console.log(data.tickers.join(','));
")

if [ $? -ne 0 ] || [ -z "$ALL_TICKERS" ]; then
  echo "[$(date)] ERROR: Watchlist file contains no tickers: $WATCHLIST_FILE" | tee -a "$LOG_FILE"
  exit 1
fi

# Split into array
IFS=',' read -ra TICKERS <<< "$ALL_TICKERS"
TOTAL=${#TICKERS[@]}

if [ $TOTAL -eq 0 ]; then
  echo "[$(date)] ERROR: Watchlist file contains no tickers: $WATCHLIST_FILE" | tee -a "$LOG_FILE"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  $DISPLAY_LABEL — $TOTAL tickers in batches of $BATCH_SIZE"
echo "  Universe: $UNIVERSE"
echo "  Concurrency: $CONCURRENCY workers per batch"
echo "  Log: $LOG_FILE"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "[$(date)] $DISPLAY_LABEL started: $TOTAL tickers, batch size $BATCH_SIZE" >> "$LOG_DIR/cron.log"
echo "[$(date)] $DISPLAY_LABEL started: $TOTAL tickers" >> "$LOG_FILE"

BATCH_NUM=0
FAILED=0
SUCCEEDED=0
START_TIME=$(date +%s)

for ((i=0; i<TOTAL; i+=BATCH_SIZE)); do
  BATCH_NUM=$((BATCH_NUM + 1))
  END=$((i + BATCH_SIZE))
  if [ $END -gt $TOTAL ]; then
    END=$TOTAL
  fi

  # Build comma-separated ticker list for this batch
  BATCH_TICKERS=""
  for ((j=i; j<END; j++)); do
    if [ -n "$BATCH_TICKERS" ]; then
      BATCH_TICKERS="$BATCH_TICKERS,${TICKERS[$j]}"
    else
      BATCH_TICKERS="${TICKERS[$j]}"
    fi
  done

  BATCH_COUNT=$((END - i))
  PROGRESS=$((END * 100 / TOTAL))

  echo "  ▸ Batch $BATCH_NUM: tickers $((i+1))–$END of $TOTAL ($PROGRESS%) ..."

  # Run tune for this batch
  if $NODE dist/src/cli.js tune-pipeline --tickers "$BATCH_TICKERS" --strategy v3 --concurrency $CONCURRENCY --universe $UNIVERSE --save >> "$LOG_FILE" 2>&1; then
    SUCCEEDED=$((SUCCEEDED + BATCH_COUNT))
    echo "    ✓ Batch $BATCH_NUM complete ($BATCH_COUNT tickers)"
  else
    FAILED=$((FAILED + BATCH_COUNT))
    echo "    ✗ Batch $BATCH_NUM failed ($BATCH_COUNT tickers)"
  fi
done

END_TIME=$(date +%s)
ELAPSED=$(( (END_TIME - START_TIME) / 60 ))

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Done in ${ELAPSED}m — $SUCCEEDED succeeded, $FAILED failed"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "[$(date)] $DISPLAY_LABEL complete: $SUCCEEDED succeeded, $FAILED failed, ${ELAPSED}m elapsed" >> "$LOG_DIR/cron.log"

# Exit non-zero if any batch failed
if [ $FAILED -gt 0 ]; then
  exit 1
fi
