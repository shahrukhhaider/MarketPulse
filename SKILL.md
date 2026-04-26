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

## Data Directory

All persistent data is stored in `.stock-tracker/` relative to `STOCK_TRACKER_HOME` (or the current working directory if unset):

| File | Purpose |
|------|---------|
| `config.json` | Watchlist, strategy assignments, settings |
| `price-data.json` | Historical price data |
| `signals-{pid}.json` | Session-scoped signal file (one per monitor process) |
| `monitor.pid` | PID of the active background process |

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
