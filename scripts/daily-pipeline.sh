#!/bin/bash
# Daily Pipeline — Scan + Auto-enter paper trades
# Runs at market open (9:30 AM ET) on weekdays
#
# Flow:
#   1. Run scan → get active signals
#   2. Print terminal summary
#   3. Auto-enter paper positions for active signals via Webull
#   4. Update existing positions (check stop/target)

set -e

PROJECT_DIR="/Users/haidex/Documents/projects/liveTrack/stock-price-tracker"
NODE="/Users/haidex/.nvm/versions/node/v20.20.2/bin/node"
PYTHON="python3"
LOG_DIR="$PROJECT_DIR/.stock-tracker/logs"
TICKERS="AAPL,MSFT,GOOGL,AMZN,NVDA,META,TSLA,JPM,HOOD,SOFI,ZETA,IREN,UNH,KTOS,ACHR,UUUU,GRAB,NOW,JNJ,NFLX"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCAN_LOG="$LOG_DIR/scan_${TIMESTAMP}.json"

echo "[$(date)] === Daily Pipeline Start ===" >> "$LOG_DIR/cron.log"

cd "$PROJECT_DIR"

# ─── Step 1: Run scan (save JSON + print summary) ───
echo "[$(date)] Running scan..." >> "$LOG_DIR/cron.log"
$NODE dist/src/cli.js scan --tickers "$TICKERS" --strategy v3 --allow-stale --summary --log "$SCAN_LOG" 2>> "$LOG_DIR/cron.log"

# ─── Step 2: Extract active signals and auto-enter ───
echo "[$(date)] Checking for active signals..." >> "$LOG_DIR/cron.log"

# Extract active signals from scan JSON using node one-liner
ACTIVE_SIGNALS=$($NODE -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('$SCAN_LOG', 'utf-8'));
  if (!data.success || !data.data || !data.data.signals) { console.log('[]'); process.exit(0); }
  const active = data.data.signals
    .filter(s => s.signal === 'active' || s.signal === 'active_late')
    .map(s => {
      const targetLine = (s.reason || []).find(r => r.includes('Target:'));
      const targetMatch = targetLine ? targetLine.match(/Target:\\s*([\\d.]+)/) : null;
      return {
        ticker: s.ticker,
        strategy: s.strategy,
        entry: s.entry,
        stop: s.stop,
        target: targetMatch ? parseFloat(targetMatch[1]) : s.entry * 1.1,
        risk_pct: s.risk_pct,
        confidence: s.confidence
      };
    });
  console.log(JSON.stringify(active));
")

ACTIVE_COUNT=$(echo "$ACTIVE_SIGNALS" | $NODE -e "const d=require('fs').readFileSync('/dev/stdin','utf-8');console.log(JSON.parse(d).length)")

if [ "$ACTIVE_COUNT" -gt "0" ]; then
  echo "[$(date)] Found $ACTIVE_COUNT active signal(s). Entering positions..." >> "$LOG_DIR/cron.log"
  $PYTHON scripts/webull-trade.py enter "$ACTIVE_SIGNALS" 2>> "$LOG_DIR/cron.log"
else
  echo "[$(date)] No active signals today." >> "$LOG_DIR/cron.log"
  echo ""
  echo "  No active signals to enter."
fi

# ─── Step 3: Update existing positions ───
echo "" 
echo "[$(date)] Updating open positions..." >> "$LOG_DIR/cron.log"
$PYTHON scripts/webull-trade.py update 2>> "$LOG_DIR/cron.log"

# ─── Step 4: Show portfolio status ───
echo ""
$PYTHON scripts/webull-trade.py status

# ─── Step 5: Journal record (capture active signals) ───
echo ""
echo "[$(date)] Recording active signals to journal..." >> "$LOG_DIR/cron.log"
$NODE dist/src/cli.js journal-record --from "$SCAN_LOG" >> "$LOG_DIR/cron.log" 2>&1 || true

# ─── Step 6: Journal update (check outcomes of open entries) ───
echo "[$(date)] Updating journal outcomes..." >> "$LOG_DIR/cron.log"
$NODE dist/src/cli.js journal-update >> "$LOG_DIR/cron.log" 2>&1 || true

echo "[$(date)] === Daily Pipeline Complete ===" >> "$LOG_DIR/cron.log"
