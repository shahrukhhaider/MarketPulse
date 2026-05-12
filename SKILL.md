# Stock Price Tracker

A CLI tool for real-time stock price tracking with watchlist management, configurable trading strategies, and automated signal generation.

## Setup

The CLI tool lives in the `stock-price-tracker` directory.

**Environment variable:**

Set `STOCK_TRACKER_HOME` to control where the `.stock-tracker/` data directory is created. If unset, defaults to the current working directory.

```bash
export STOCK_TRACKER_HOME=/path/to/stock-price-tracker
```

**Invocation format:**

```bash
node dist/src/cli.js <command> [options]
```

All commands return structured JSON to stdout conforming to the `CommandResult` envelope:

```json
{
  "success": true | false,
  "command": "<command-name>",
  "data": { ... },
  "error": { "code": "...", "message": "..." },
  "timestamp": "ISO-8601"
}
```

Always parse the JSON output. Check `success` to determine if the command succeeded. On failure, `error.code` and `error.message` describe what went wrong.

## Commands

### 1. add-stock

Add a stock to the watchlist.

```bash
node dist/src/cli.js add-stock --ticker <SYMBOL>
```

| Param | Required | Description |
|-------|----------|-------------|
| `--ticker` | Yes | Stock ticker symbol (1–10 alphabetic characters, e.g. AAPL, GOOGL) |

**Natural language triggers:** "add AAPL to my watchlist", "track GOOGL", "start watching MSFT", "monitor Tesla stock"

**Example:**
```bash
node dist/src/cli.js add-stock --ticker AAPL
```

**Error codes:** `INVALID_TICKER` (symbol not found in price feed), `DUPLICATE_STOCK` (already tracked)

---

### 2. remove-stock

Remove a stock from the watchlist.

```bash
node dist/src/cli.js remove-stock --ticker <SYMBOL>
```

| Param | Required | Description |
|-------|----------|-------------|
| `--ticker` | Yes | Stock ticker symbol to remove |

**Natural language triggers:** "remove AAPL from my watchlist", "stop tracking GOOGL", "unwatch MSFT", "drop Tesla"

**Example:**
```bash
node dist/src/cli.js remove-stock --ticker AAPL
```

**Error codes:** `STOCK_NOT_FOUND` (ticker not in watchlist)

---

### 3. list-watchlist

List all stocks currently in the watchlist with their last known prices.

```bash
node dist/src/cli.js list-watchlist
```

No parameters required.

**Natural language triggers:** "show my watchlist", "what stocks am I tracking", "list my stocks", "show tracked stocks"

**Example:**
```bash
node dist/src/cli.js list-watchlist
```

Returns `data.stocks` array with `ticker`, `addedAt`, `strategies`, `lastPrice`, and `lastPriceTimestamp` for each entry.

---

### 4. start-monitor

Spawn a background monitoring process that continuously polls prices and evaluates strategies.

```bash
node dist/src/cli.js start-monitor [--interval <seconds>]
```

| Param | Required | Description |
|-------|----------|-------------|
| `--interval` | No | Polling interval in seconds (positive integer, default: 60) |

**Natural language triggers:** "start monitoring", "begin tracking prices", "start the monitor", "watch my stocks continuously", "start polling every 30 seconds"

**Example:**
```bash
node dist/src/cli.js start-monitor --interval 30
```

On success, `data` includes `pid`, `signalFilePath`, `sessionStartTime`, and `pollingInterval`. Save the `signalFilePath` — you will need it to check for signals.

**Error codes:** `MONITOR_ALREADY_RUNNING` (a session is already active)

---

### 5. stop-monitor

Terminate the active background monitoring process.

```bash
node dist/src/cli.js stop-monitor
```

No parameters required.

**Natural language triggers:** "stop monitoring", "stop the monitor", "end monitoring session", "stop watching prices"

**Example:**
```bash
node dist/src/cli.js stop-monitor
```

**Error codes:** `MONITOR_NOT_RUNNING` (no active session)

---

### 6. get-status

Get the current monitoring session status.

```bash
node dist/src/cli.js get-status
```

No parameters required.

**Natural language triggers:** "what's the monitor status", "is monitoring running", "show monitor status", "check monitoring"

**Example:**
```bash
node dist/src/cli.js get-status
```

Returns `data.state` as `"running"` or `"stopped"`. When running, also includes `pid`, `signalFilePath`, `sessionStartTime`, and `pollingInterval`.

---

### 7. configure-strategy

Assign or configure a trading strategy for a stock in the watchlist.

```bash
node dist/src/cli.js configure-strategy --ticker <SYMBOL> --strategy <TYPE> [--params <JSON>] [--enabled <bool>]
```

| Param | Required | Description |
|-------|----------|-------------|
| `--ticker` | Yes | Stock ticker symbol (must already be in watchlist) |
| `--strategy` | Yes | Strategy type (see below) |
| `--params` | No | JSON string of strategy parameters |
| `--enabled` | No | `true` or `false` to enable/disable the strategy |

**Strategy types and their parameters:**

| Type | Params | Defaults | Validation |
|------|--------|----------|------------|
| `moving_average_crossover` | `{"shortWindow": N, "longWindow": M}` | short=10, long=50 | shortWindow > 0, longWindow > shortWindow |
| `rsi_threshold` | `{"period": N, "overbought": X, "oversold": Y}` | period=14, overbought=70, oversold=30 | period > 0, 0 < oversold < overbought < 100 |
| `price_breakout` | `{"upperLevel": X, "lowerLevel": Y}` | upper=100, lower=50 | upperLevel > lowerLevel > 0 |

**Natural language triggers:** "set up moving average strategy for AAPL", "configure RSI for GOOGL with period 20", "add price breakout strategy to MSFT", "disable the RSI strategy for AAPL", "enable moving average for TSLA"

**Examples:**
```bash
# Configure with custom params
node dist/src/cli.js configure-strategy --ticker AAPL --strategy moving_average_crossover --params '{"shortWindow":5,"longWindow":20}'

# Configure RSI with defaults
node dist/src/cli.js configure-strategy --ticker GOOGL --strategy rsi_threshold

# Disable a strategy
node dist/src/cli.js configure-strategy --ticker AAPL --strategy rsi_threshold --enabled false

# Configure and immediately enable
node dist/src/cli.js configure-strategy --ticker MSFT --strategy price_breakout --params '{"upperLevel":200,"lowerLevel":150}' --enabled true
```

**Error codes:** `STOCK_NOT_FOUND` (ticker not in watchlist), `INVALID_PARAM_RANGE` (invalid strategy type or parameter values)

---

### 8. show-signals

Show the history of generated trading signals, ordered most recent first.

```bash
node dist/src/cli.js show-signals [--limit <N>]
```

| Param | Required | Description |
|-------|----------|-------------|
| `--limit` | No | Maximum number of signals to return (non-negative integer) |

**Natural language triggers:** "show signals", "any trading signals", "show me recent signals", "what signals have been generated", "show last 5 signals"

**Example:**
```bash
node dist/src/cli.js show-signals --limit 10
```

Returns `data.signals` array. Each signal contains `id`, `ticker`, `direction` (BUY/SELL/HOLD), `strategyType`, `price`, `timestamp`, and optionally `previousDirection` and `previousTimestamp` for signal transitions.

If no monitoring session is active, returns an empty signals array with a message.

---

## Signal Detection

The background monitoring process writes trading signals to a session-scoped file on disk. To detect new signals:

1. After calling `start-monitor`, note the `signalFilePath` from the response (e.g., `.stock-tracker/signals-12345.json`).
2. Periodically invoke `show-signals` to check for new BUY or SELL signals.
3. Present any BUY or SELL signals to the user with the ticker, direction, strategy name, and current price.

**Recommended polling approach:**
- After starting the monitor, periodically run `show-signals` (e.g., every 1–2 polling intervals).
- Filter for signals with `direction` of `BUY` or `SELL` (ignore `HOLD`).
- The system suppresses duplicate consecutive signals for the same stock/strategy/direction, so each signal returned represents a meaningful event.
- When a signal includes `previousDirection` and `previousTimestamp`, mention the transition to the user (e.g., "AAPL changed from HOLD to BUY").

**Signal file format** (for direct file reading if needed):
```json
{
  "sessionPid": 12345,
  "signals": [
    {
      "id": "sig_001",
      "ticker": "AAPL",
      "direction": "BUY",
      "strategyType": "moving_average_crossover",
      "price": 196.20,
      "timestamp": "2025-01-15T10:01:00Z",
      "previousDirection": "HOLD",
      "previousTimestamp": "2025-01-15T09:55:00Z"
    }
  ],
  "lastUpdated": "2025-01-15T10:01:00Z"
}
```

## Typical Workflows

### Quick start: Track a stock and monitor

```bash
node dist/src/cli.js add-stock --ticker AAPL
node dist/src/cli.js configure-strategy --ticker AAPL --strategy moving_average_crossover
node dist/src/cli.js start-monitor --interval 30
# ... wait, then check signals ...
node dist/src/cli.js show-signals --limit 5
node dist/src/cli.js stop-monitor
```

### Multi-strategy setup

```bash
node dist/src/cli.js add-stock --ticker AAPL
node dist/src/cli.js add-stock --ticker GOOGL
node dist/src/cli.js configure-strategy --ticker AAPL --strategy moving_average_crossover --params '{"shortWindow":5,"longWindow":20}'
node dist/src/cli.js configure-strategy --ticker AAPL --strategy rsi_threshold
node dist/src/cli.js configure-strategy --ticker GOOGL --strategy price_breakout --params '{"upperLevel":180,"lowerLevel":160}'
node dist/src/cli.js start-monitor
```

---

### 9. backtest

Run a historical backtest for a strategy against a ticker.

```bash
node dist/src/cli.js backtest --ticker <SYMBOL> --strategy <TYPE> [--period <PERIOD>] [--params <JSON>] [--chart] [--no-cache]
```

| Param | Required | Description |
|-------|----------|-------------|
| `--ticker` | Yes | Stock ticker symbol |
| `--strategy` | Yes | Strategy type: `momentum_continuation`, `trend_pullback`, `breakout_volume`, `consolidation_breakout`, `moving_average_crossover`, `rsi_threshold`, `price_breakout` |
| `--period` | No | Historical period: `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y` (default: `1y`) |
| `--params` | No | JSON string of strategy parameters (uses defaults if omitted) |
| `--chart` | No | Generate an HTML chart and open it in the browser |
| `--no-cache` | No | Bypass the historical data cache |

**Natural language triggers:** "backtest NVDA with momentum", "run a backtest on TSLA breakout strategy", "test momentum continuation on AAPL over 2 years"

**Example:**
```bash
# Backtest with defaults
node dist/src/cli.js backtest --ticker NVDA --strategy momentum_continuation --period 2y

# Backtest with chart output
node dist/src/cli.js backtest --ticker NVDA --strategy momentum_continuation --period 2y --chart
```

Returns `data.performanceSummary` with `totalReturnPercent`, `numberOfTrades`, `winRate`, `maxDrawdownPercent`, `sharpeRatio`, and individual `trades`.

---

### 10. tune

Run parameter grid search to find optimal strategy parameters for a ticker.

```bash
node dist/src/cli.js tune --ticker <SYMBOL> --strategy <TYPE> [--horizon <HORIZON>] [--risk <PROFILE>] [--no-cache]
```

| Param | Required | Description |
|-------|----------|-------------|
| `--ticker` | Yes | Stock ticker symbol |
| `--strategy` | Yes | Tunable strategy: `momentum_continuation`, `trend_pullback`, `breakout_volume`, `consolidation_breakout` |
| `--horizon` | No | Time horizon: `short_term` or `long_term` (default: `long_term`) |
| `--risk` | No | Risk profile: `low`, `medium`, `high` |
| `--no-cache` | No | Bypass the historical data cache |
| `--v3` | No | Use V3 consolidation breakout engine (required for `consolidation_breakout` strategy) |

**Natural language triggers:** "tune NVDA momentum strategy", "optimize breakout parameters for TSLA", "find best params for trend pullback on AAPL", "tune consolidation breakout for NVDA"

**Example:**
```bash
node dist/src/cli.js tune --ticker NVDA --strategy momentum_continuation --horizon short_term

# V3 consolidation breakout tuning
node dist/src/cli.js tune --ticker NVDA --strategy consolidation_breakout --v3
```

Returns `data.best_region` with optimal parameter ranges and `data.best_score`.

---

### 11. tune-and-chart

Tune parameters, then run a backtest with the optimized params and generate an HTML chart. This is the recommended workflow for evaluating a strategy.

```bash
node dist/src/cli.js tune-and-chart --ticker <SYMBOL> --strategy <TYPE> [--horizon <HORIZON>] [--risk <PROFILE>] [--no-cache]
```

| Param | Required | Description |
|-------|----------|-------------|
| `--ticker` | Yes | Stock ticker symbol |
| `--strategy` | Yes | Tunable strategy: `momentum_continuation`, `trend_pullback`, `breakout_volume`, `consolidation_breakout` |
| `--horizon` | No | Time horizon: `short_term` or `long_term` (default: `long_term`) |
| `--risk` | No | Risk profile: `low`, `medium`, `high` |
| `--no-cache` | No | Bypass the historical data cache |
| `--v3` | No | Use V3 consolidation breakout engine (required for `consolidation_breakout` strategy) |

**Natural language triggers:** "tune and backtest NVDA momentum", "optimize and chart breakout for TSLA", "run full analysis on AAPL trend pullback", "tune and chart consolidation breakout for NVDA"

**Example:**
```bash
node dist/src/cli.js tune-and-chart --ticker NVDA --strategy momentum_continuation --horizon short_term

# V3 consolidation breakout — tune, backtest, and chart in one step
node dist/src/cli.js tune-and-chart --ticker NVDA --strategy consolidation_breakout --v3
```

For V3, returns `data.tuning` (best params and metrics), `data.best_params`, and `data.backtest` (performance + chart path). Opens the chart in the browser automatically.

---

### 12. clear-cache

Clear cached historical data.

```bash
node dist/src/cli.js clear-cache [--ticker <SYMBOL>]
```

| Param | Required | Description |
|-------|----------|-------------|
| `--ticker` | No | Clear cache for a specific ticker only. If omitted, clears all cached data. |

**Natural language triggers:** "clear cache", "refresh data for NVDA", "clear historical data cache"

**Example:**
```bash
# Clear all cache
node dist/src/cli.js clear-cache

# Clear cache for one ticker
node dist/src/cli.js clear-cache --ticker NVDA
```

---

## Typical Workflows (continued)

### Tune and evaluate a strategy

The recommended workflow is: tune first, then backtest with optimized params.

```bash
# Option 1: All-in-one (tune + backtest + chart)
node dist/src/cli.js tune-and-chart --ticker NVDA --strategy momentum_continuation --horizon short_term

# Option 2: Step by step
# Step 1: Tune to find optimal parameters
node dist/src/cli.js tune --ticker NVDA --strategy momentum_continuation --horizon short_term
# Step 2: Backtest with the tuned params (copy best_region midpoints into --params)
node dist/src/cli.js backtest --ticker NVDA --strategy momentum_continuation --period 2y --chart --params '{"config": {...}}'
```

### V3 Consolidation Breakout workflow

The consolidation breakout engine (V3) detects consolidation → breakout patterns with volume confirmation. Use `--v3` flag.

```bash
# All-in-one: tune + backtest + chart
node dist/src/cli.js tune-and-chart --ticker NVDA --strategy consolidation_breakout --v3

# Tune only
node dist/src/cli.js tune --ticker NVDA --strategy consolidation_breakout --v3
```

V3 uses 5 years of data and searches 4,374+ parameter combinations. The tuner selects the config with the highest total return (minimum 3 trades required). Tunable parameters: `consolidation_window`, `max_range_pct`, `atr_ratio_threshold`, `volume_multiplier`, `overextension_pct`, `atr_multiple`, `swing_lookback`, `max_risk_pct`, `r_multiple`.

### V3 Pipeline (recommended)

The V3 pipeline is the primary workflow for strategy optimization. It tunes both strategies and produces a combined backtest chart in one command:

```bash
# Single ticker — tune, backtest, chart
node dist/src/cli.js v3 --ticker NVDA

# Multiple tickers in parallel
node dist/src/cli.js v3 --ticker NVDA,AAPL,AMD,TSLA --concurrency 8

# All top 100 tickers (weekly batch)
node dist/src/cli.js v3 --ticker top100 --concurrency 16
```

After running, find results at:
```bash
ls -lt stock-price-tracker/.stock-tracker/NVDA_backtest_*.html | head -1
```

### Daily Scan (after tuning)

Once profiles are saved (via `v3`), run a daily scan to detect current signals:

```bash
# Scan a single ticker for both strategies
node dist/src/cli.js scan --tickers NVDA --strategy v3

# Scan multiple tickers
node dist/src/cli.js scan --tickers NVDA,AAPL,AMD --strategy v3

# Scan all top 100
node dist/src/cli.js scan --tickers top100 --strategy v3 --concurrency 16

# Allow stale profiles (expired but still usable)
node dist/src/cli.js scan --tickers NVDA --strategy v3 --allow-stale
```

**npm shortcut:**
```bash
npm run scan -- --tickers NVDA --strategy v3
```

The scan loads saved profiles from `.stock-tracker/profiles/` and runs signal detection on the latest 1-year data. Signals are sorted by priority: `active` > `active_late` > `extended` > `pressure` > `near` > `forming` > `none`.

**Output includes:**
- `signals[]` — array of signal results per ticker/strategy with `signal` state, `confidence`, `reason[]`
- `warnings[]` — any tickers that couldn't be scanned (missing profile, expired, data error)

### Scan Chart (visual signal overlay)

Generate a focused chart showing signal detection overlaid on recent price action:

```bash
# Generate scan chart for a ticker
node dist/src/cli.js scan-chart --ticker NVDA --strategy consolidation_breakout

# Or for trend pullback
node dist/src/cli.js scan-chart --ticker NVDA --strategy trend_pullback
```

**npm shortcut:**
```bash
npm run scan-chart -- --ticker NVDA --strategy consolidation_breakout
```

The scan chart shows ~1 year of price data with consolidation zones, breakout levels, entry/stop prices, and the current signal state. Output saved to `.stock-tracker/{TICKER}_scan_{timestamp}.html`.

### Full Workflow: Tune → Backtest → Scan

The complete weekly-tune / daily-scan pipeline:

```bash
# Step 1: Weekly — Tune and backtest (saves profiles)
node dist/src/cli.js v3 --ticker NVDA

# Step 2: Daily — Scan for current signals using saved profiles
node dist/src/cli.js scan --tickers NVDA --strategy v3

# Step 3: Optional — Generate visual scan chart for actionable signals
node dist/src/cli.js scan-chart --ticker NVDA --strategy consolidation_breakout
```

For batch operations (cron jobs):
```bash
# Weekly tune (Sunday night)
node dist/src/cli.js v3 --ticker top100 --concurrency 16

# Daily scan (market open)
node dist/src/cli.js scan --tickers top100 --strategy v3 --concurrency 16
```

See `scripts/crontab.txt` for recommended cron schedules.

### Compare strategies for a ticker

```bash
node dist/src/cli.js tune-and-chart --ticker NVDA --strategy momentum_continuation --horizon short_term
node dist/src/cli.js tune-and-chart --ticker NVDA --strategy breakout_volume --horizon short_term
node dist/src/cli.js tune-and-chart --ticker NVDA --strategy consolidation_breakout --v3
```

---

### 13. v3 (V3 Pipeline — Tune + Backtest + Chart)

The primary command for running the full V3 strategy pipeline: tunes both `consolidation_breakout` and `trend_pullback` strategies, backtests with the best params, saves profiles, and generates a combined HTML chart.

```bash
node dist/src/cli.js v3 --ticker <SYMBOL_OR_LIST> [--concurrency <N>] [--no-cache]
```

| Param | Required | Description |
|-------|----------|-------------|
| `--ticker` | Yes | Single ticker (e.g. `NVDA`), comma-separated list (e.g. `NVDA,AAPL,AMD`), or `top100` to load from `data/top100.json` |
| `--concurrency` | No | Number of parallel workers for multi-ticker (1–64, default: 8) |
| `--no-cache` | No | Bypass the historical data cache and fetch fresh data |

**npm shortcut:**
```bash
npm run v3 -- --ticker NVDA
```

**Natural language triggers:** "run v3 for NVDA", "tune and backtest NVDA", "run the full pipeline for AAPL", "v3 top100"

**What it does (single ticker):**
1. Fetches 5 years of historical daily data
2. Splits into 70% in-sample / 30% out-of-sample
3. Runs grid search tuning for both strategies (~8,748 configs each)
4. Evaluates best config on OOS data
5. Saves optimized profiles to `.stock-tracker/profiles/`
6. Runs full backtest on the complete 5y dataset with tuned params
7. Generates a combined HTML chart at `.stock-tracker/{TICKER}_backtest_{timestamp}.html`

**What it does (multi-ticker):**
- Spawns parallel worker processes (up to `--concurrency`)
- Each worker runs the full single-ticker pipeline independently
- Returns batch results with per-ticker summaries

**Examples:**
```bash
# Single ticker
node dist/src/cli.js v3 --ticker NVDA

# Multiple tickers
node dist/src/cli.js v3 --ticker NVDA,AAPL,AMD,TSLA

# All top 100 tickers with 16 workers
node dist/src/cli.js v3 --ticker top100 --concurrency 16

# Force fresh data (bypass cache)
node dist/src/cli.js v3 --ticker NVDA --no-cache
```

**Output structure:**
```json
{
  "success": true,
  "command": "v3",
  "data": {
    "tune": {
      "consolidation_breakout": { "status": "success", "in_sample": {...}, "out_of_sample": {...} },
      "trend_pullback": { "status": "success", "in_sample": {...}, "out_of_sample": {...} }
    },
    "backtest": {
      "consolidation_breakout": { "performance": {...}, "trades": [...] },
      "trend_pullback": { "performance": {...}, "trades": [...] },
      "combined": { "totalReturnPercent": ..., "winRate": ..., ... }
    },
    "chartFilePath": ".stock-tracker/NVDA_backtest_1778469340088.html",
    "chartUrl": "file:///path/to/NVDA_backtest_1778469340088.html"
  }
}
```

---

## Finding and Comparing Backtest Results

### Locating result files

All backtest charts are saved as HTML files in `.stock-tracker/`:

```bash
# List all backtest results for a ticker, sorted by date (newest first)
ls -lt stock-price-tracker/.stock-tracker/{TICKER}_backtest_*.html

# Example for NVDA
ls -lt stock-price-tracker/.stock-tracker/NVDA_backtest_*.html
```

File naming: `{TICKER}_backtest_{unix_timestamp_ms}.html`

### Extracting performance metrics from HTML files

The HTML files contain performance metrics in the header section. Extract them with:

```bash
head -100 stock-price-tracker/.stock-tracker/NVDA_backtest_1778469340088.html | grep -i 'return\|win\|trade\|sharpe\|drawdown'
```

This outputs metrics for both strategies:
- First block = consolidation_breakout (Total Return, Benchmark Return, Trades, Win Rate, Max Drawdown, Sharpe Ratio)
- Second block = trend_pullback (Total Return, Trades, Win Rate, Max Drawdown, Sharpe Ratio)

### Comparing two backtest runs

To verify that two runs produce identical results (e.g., after a code change):

```bash
# Byte-level comparison (empty output = identical)
diff stock-price-tracker/.stock-tracker/NVDA_backtest_<NEW>.html stock-price-tracker/.stock-tracker/NVDA_backtest_<OLD>.html

# Quick metric comparison
head -100 stock-price-tracker/.stock-tracker/NVDA_backtest_<NEW>.html | grep -i 'return\|win\|trade\|sharpe\|drawdown'
head -100 stock-price-tracker/.stock-tracker/NVDA_backtest_<OLD>.html | grep -i 'return\|win\|trade\|sharpe\|drawdown'
```

If `diff` returns no output, the files are byte-for-byte identical — confirming behavioral equivalence.

### Viewing charts

Open the HTML file directly in a browser:

```bash
open stock-price-tracker/.stock-tracker/NVDA_backtest_1778469340088.html
```

The chart shows:
- Price history with buy/sell markers for both strategies
- Equity curve
- Performance metrics summary
- Individual trade details

---

## Data Directory

All persistent data is stored in `.stock-tracker/` relative to `STOCK_TRACKER_HOME` (or the current working directory if unset):

| File | Purpose |
|------|---------|
| `config.json` | Watchlist, strategy assignments, settings |
| `price-data.json` | Historical price data |
| `signals-{pid}.json` | Session-scoped signal file (one per monitor process) |
| `monitor.pid` | PID of the active background process |
| `history-cache/` | Cached historical data (24h TTL) |
| `profiles/` | Saved strategy profiles from tuning (JSON, one per ticker+strategy) |
| `{TICKER}_backtest_{timestamp}.html` | Backtest chart visualizations |
| `{TICKER}_scan_{timestamp}.html` | Scan chart visualizations (signal overlay on recent price) |
| `{TICKER}_{strategy}_{horizon}_{risk}.json` | Tuning result cache |

## Error Handling

All errors return JSON with `success: false`. Common error codes:

| Code | Meaning |
|------|---------|
| `INVALID_TICKER` | Ticker symbol not recognized by the price feed |
| `MISSING_PARAM` | A required parameter was not provided |
| `INVALID_PARAM_RANGE` | A parameter value is outside its valid range |
| `DUPLICATE_STOCK` | Stock is already in the watchlist |
| `STOCK_NOT_FOUND` | Stock is not in the watchlist |
| `MONITOR_ALREADY_RUNNING` | A monitoring session is already active |
| `MONITOR_NOT_RUNNING` | No monitoring session to stop |
| `INSUFFICIENT_DATA` | Not enough price history for strategy evaluation |
| `PRICE_FEED_UNAVAILABLE` | Price feed API is unreachable |
