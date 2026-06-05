# Stock Price Tracker

A TypeScript CLI tool for automated stock signal detection, strategy tuning, backtesting, and trade journaling. Designed for personal, non-commercial use as a daily trading assistant.

## Documentation

- [Strategies Guide](docs/STRATEGIES.md) — Annotated charts explaining each trading strategy
- [Signal Glossary](docs/SIGNAL-GLOSSARY.md) — Reference for reading daily scan notifications and Discord alerts

## Features

- **Signal Detection** — Scan watchlists daily for trade entry signals across multiple strategies
- **Strategy Tuning** — Walk-forward parameter optimization with profile persistence
- **Backtesting** — Evaluate strategies against historical data with HTML chart output
- **Market Regime Detection** — Classify market conditions (bull/bear/neutral) using SuperTrend
- **Trade Journal** — Track signal-to-outcome with win rate, expectancy, and P&L stats
- **Paper Trading** — Webull integration for auto-entering and managing paper positions
- **Discord Notifications** — Per-universe webhook alerts when signals fire
- **Cron Automation** — Scheduled scans, signal checks, and weekly tuning

## Requirements

- Node.js >= 18.0.0
- npm
- Python 3 (for paper trading scripts only)

## Installation

```bash
git clone <repo-url> && cd stock-price-tracker
npm install
npm run build
```

## Quick Start

```bash
# Build the project
npm run build

# Run a full V3 tune + backtest + chart for a ticker
npm run v3 -- --ticker AAPL

# Scan your watchlist for today's signals
npm run scan -- --tickers watchlist --strategy v3

# Scan with human-readable summary
npm run scan-summary -- --tickers AAPL,NVDA,TSLA --strategy v3

# Check market regime
npm run regime -- --tickers AAPL,NVDA,SPY
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run v3 -- --ticker <SYM>` | Full pipeline: tune + backtest + chart |
| `npm run scan -- --tickers <LIST> --strategy v3` | Daily signal detection |
| `npm run scan-summary -- --tickers <LIST> --strategy v3` | Scan with formatted summary |
| `npm run tune -- --tickers <LIST> --strategy v3 --save` | Batch parameter optimization |
| `npm run chart -- --ticker <SYM> --strategy <TYPE>` | Backtest visualization (HTML) |
| `npm run scan-chart -- --ticker <SYM> --strategy <TYPE>` | Signal overlay chart |
| `npm run regime -- --tickers <LIST>` | Market regime detection |
| `npm run journal:status` | Journal stats (win rate, P&L, etc.) |
| `npm run journal:record -- --from <SCAN_LOG>` | Record active signals to journal |
| `npm run journal:update` | Update open journal entries with outcomes |
| `npm run paper:status` | Show paper trading positions |
| `npm run paper:update` | Update stops/targets on open positions |
| `npm run paper:close` | Close paper positions |
| `npm run pipeline` | Full daily pipeline (scan → enter → journal) |

## Strategies (V3)

| Strategy | Description |
|----------|-------------|
| `consolidation_breakout` | Tight-range breakout with volume confirmation |
| `trend_pullback` | Pullback entry in established uptrend |
| `bear_breakdown` | Short-side breakdown in downtrend |
| `keltner_mean_reversion` | Mean reversion at Keltner channel extremes |
| `post_earnings_drift` | Momentum continuation after earnings surprise |
| `volume_dry_up` | Low-volume contraction preceding expansion |

## Universes

Watchlists are organized by market cap:

| Universe | Watchlist file |
|----------|---------------|
| `large_cap` | `.stock-tracker/data/watchlist.json` |
| `mid_cap` | `.stock-tracker/data/watchlist-midcap.json` |
| `small_cap` | `.stock-tracker/data/watchlist-smallcap.json` |
| `tech` | `.stock-tracker/data/watchlist-tech.json` |

Use `--universe <name>` with scan/tune commands to target a specific universe.

## Automation

Install the cron schedule for automated daily scans and weekly tuning:

```bash
crontab scripts/crontab.txt
```

**Schedule:**

| Job | Time | Days |
|-----|------|------|
| Daily scan (large_cap) | 4:30 PM ET | Mon–Fri |
| Daily scan (tech) | 4:45 PM ET | Mon–Fri |
| Signal check | 10 AM, 12 PM, 3:30 PM ET | Mon–Fri |
| Weekly tune (large_cap) | 9:00 AM ET | Sunday |
| Weekly tune (tech) | 11:00 AM ET | Sunday |

## Discord Notifications

To enable Discord alerts for a universe, create a webhook file:

```bash
echo "https://discord.com/api/webhooks/..." > .stock-tracker/discord-webhook-large_cap.txt
```

Replace `large_cap` with the target universe name.

## Data Directory

All runtime data lives in `.stock-tracker/`:

```
.stock-tracker/
├── data/
│   ├── profiles/          # Tuned strategy parameters per ticker
│   ├── watchlist.json     # Large-cap ticker list
│   └── watchlist-*.json   # Other universe lists
├── history-cache/         # 24h OHLCV data cache
├── logs/                  # Scan/tune/cron logs
├── journal.ndjson         # Trade journal entries
└── *.html                 # Backtest chart outputs
```

## Development

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Property-based tests
npm run test:property

# Integration tests
npm run test:integration
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `STOCK_TRACKER_HOME` | Base directory for data storage | Current working directory |

## Output Format

All CLI commands return structured JSON:

```json
{
  "success": true,
  "command": "scan",
  "data": { ... },
  "timestamp": "2025-06-05T..."
}
```

Check the `success` field to determine pass/fail in scripts.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.MD) — Free for personal and non-commercial use. Commercial use is prohibited.
