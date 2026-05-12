# Extension Plan: Slack Channel Distribution via MeshClaw

## Goal

Distribute the stock price tracker to an Amazon internal Slack channel so channel members can both receive automated trading signals and interactively query stock data through natural language.

## Architecture: Hybrid Push + Interactive

A single MeshClaw instance (run by the operator) serves as the bridge between the stock tracker CLI and the Slack channel.

```
┌─────────────────────────────────────────────────┐
│  Operator's Host (Cloud Desktop / EC2)          │
│                                                 │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │ stock-price- │◄───│ MeshClaw Agent        │  │
│  │ tracker CLI  │    │  - SKILL.md loaded     │  │
│  └──────────────┘    │  - Cron jobs (push)    │  │
│                      │  - Channel listener    │  │
│                      └──────────┬────────────┘  │
└─────────────────────────────────┼───────────────┘
                                  │ Slack API
                                  ▼
                        ┌──────────────────┐
                        │  #stock-channel   │
                        │                  │
                        │  📢 Auto signals │
                        │  💬 User queries │
                        └──────────────────┘
```

### Push: Automated Signal Alerts

Cron jobs run on a schedule, poll for new BUY/SELL signals, and post them to the channel automatically.

### Interactive: User Queries

Channel members @mention MeshClaw to ask questions. MeshClaw uses the SKILL.md to translate natural language into CLI commands and responds in-channel.

**Example interactions:**
- "@MeshClaw add TSLA to the watchlist"
- "@MeshClaw what's AAPL's current price?"
- "@MeshClaw show recent signals"
- "@MeshClaw set up RSI strategy for GOOGL with period 20"

## Setup Steps

### Prerequisites

- A host running MeshClaw (Cloud Desktop, EC2, etc.)
- The stock-price-tracker CLI built and available on that host
- The MeshClaw Slack bot invited to the target channel

### 1. Install the CLI on the MeshClaw Host

```bash
git clone <repo-url> stock-price-tracker
cd stock-price-tracker
npm install
npm run build
```

### 2. Load the Skill

Copy the SKILL.md into the MeshClaw project's skills directory:

```bash
mkdir -p <meshclaw-project>/.kiro/skills/
cp SKILL.md <meshclaw-project>/.kiro/skills/stock-price-tracker.md
```

Or symlink it so updates propagate automatically:

```bash
ln -s $(pwd)/SKILL.md <meshclaw-project>/.kiro/skills/stock-price-tracker.md
```

### 3. Configure Channel Access

In Slack DM to your MeshClaw:

```
!allowlist #stock-channel
```

Then allowlist trusted channel members:

```
!allowlist @teammate1
!allowlist @teammate2
```

### 4. Set Up Automated Signal Posting

Set up cron jobs via MeshClaw to push signals to the channel. Example:

```
cron add "stock-signals" "Check for new BUY/SELL signals using show-signals and post any actionable ones to the channel. Ignore HOLD signals." every 120 --channel C0XXXXXXXX
```

Adjust the interval based on the monitor's polling frequency.

### 5. Start Monitoring

Either via MeshClaw in Slack:

```
@MeshClaw start monitoring every 60 seconds
```

Or directly on the host:

```bash
cd stock-price-tracker
node dist/src/cli.js start-monitor --interval 60
```

## Operational Notes

### Single Operator Model

- One person runs the MeshClaw instance and the stock tracker
- The watchlist is shared — all channel members see and contribute to the same watchlist
- The operator manages the allowlist and infrastructure

### Availability

- If the host goes down, both automated signals and interactive queries stop
- Consider running on a persistent host (EC2 with systemd) rather than a Cloud Desktop for reliability
- MeshClaw supports systemd service configuration for auto-restart

### Access Control

- Only allowlisted users can interact with MeshClaw in the channel
- The operator controls who gets access via `!allowlist`
- All interactions are visible in the channel (transparent to members)

## Future Enhancements

### Per-User Watchlists

The current model uses a single shared watchlist. To support per-user watchlists, the CLI would need a `--user` parameter and the config store would need user-scoped data directories.

### Self-Service Distribution

For broader adoption where each person runs their own instance:

1. **Publish CLI to internal npm** — `npm publish` to NpmPrettyMuch as `@amzn/stock-price-tracker`
2. **Share the SKILL.md** — users copy it into their own MeshClaw/Kiro skills directory
3. **Document the setup** — each user installs the CLI and loads the skill on their own host

### Dedicated Slack Bot

For a production-grade channel experience, replace the MeshClaw dependency with a purpose-built Slack bot:

- Slash commands (`/stock add AAPL`, `/stock signals`)
- Hosted on Lambda + API Gateway for high availability
- DynamoDB for per-user state
- No dependency on any individual's host

---

# Extension Plan: Multi-Layer Trading Pipeline

## Goal

Evolve the stock-price-tracker from a flat scan-and-signal system into a layered pipeline where each layer filters, enriches, and ranks trade opportunities. The layers build incrementally — each can be developed and tested independently.

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  Layer 1: Market / Trend Regime (FILTER)                           │
│  ─────────────────────────────────────                             │
│  SuperTrend state (bullish/bearish per ticker)                     │
│  Market regime (SPY/QQQ broad direction)                           │
│  Volatility regime (ATR expansion/contraction)                     │
│  Trend strength (how established)                                  │
│                                                                     │
│  Output: regime_state per ticker → pass/block to Layer 2           │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 2: Opportunity Discovery (DETECT)                  [EXISTS]  │
│  ─────────────────────────────────────────                         │
│  Consolidation breakout (existing)                                 │
│  Trend pullback (existing)                                         │
│  Momentum continuation (future)                                    │
│  Breakout volume (future)                                          │
│                                                                     │
│  Output: raw signals (active/near/forming) per ticker+strategy     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 3: Trade Setup / Ranking / Confidence (RANK)      [PARTIAL]  │
│  ──────────────────────────────────────────────                    │
│  Strategy score (from tuning OOS metrics)                          │
│  Regime alignment (Layer 1 agrees with Layer 2 direction)          │
│  Signal overlap (multiple strategies fire on same ticker)          │
│  Risk/reward ratio                                                 │
│  Confidence score (existing, from weight presets)                   │
│                                                                     │
│  Output: ranked list of trade setups with composite score          │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 4: Trade Monitoring (TRACK)                       [PARTIAL]  │
│  ─────────────────────────────────────                             │
│  Signal Journal (just built — records + tracks outcomes)           │
│  Hold / watch / reduce / exit alerts                               │
│  Position aging (days open, R-multiple progress)                   │
│  Webull paper trading integration (future)                         │
│                                                                     │
│  Output: portfolio state, P&L, alerts                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Current State

| Layer | Status | What Exists |
|-------|--------|-------------|
| 1 — Regime | **Not started** | SuperTrend PineScript reference (`scripts/super-trend.txt`) |
| 2 — Discovery | **Complete** | consolidation_breakout + trend_pullback engines, scan command |
| 3 — Ranking | **Partial** | Confidence score (weight presets), R:R in signal output |
| 4 — Monitoring | **Partial** | Signal Journal (records + tracks), scan-summary (terminal view) |

## Layer 1: SuperTrend Regime — Design Notes

### Core Algorithm (from PineScript reference)

```
ATR = True ATR over N periods (default: 26)
Multiplier = 3.7

Upper Band = source - (Multiplier × ATR)
Lower Band = source + (Multiplier × ATR)

Trend = 1 (bullish) when close crosses above Lower Band
Trend = -1 (bearish) when close drops below Upper Band

Bands ratchet: Upper only moves up, Lower only moves down
```

### Implementation Plan

1. **`src/supertrend.ts`** — Pure function: `computeSuperTrend(data, period, multiplier) → { trend: 1|-1, upperBand, lowerBand }[]`
2. **`src/regime-detector.ts`** — Wraps SuperTrend + market-level checks:
   - Per-ticker regime: SuperTrend(ticker, 26, 3.7)
   - Market regime: SuperTrend(SPY, 26, 3.7)
   - Volatility regime: ATR(14) vs ATR(50) ratio
   - Output: `{ ticker, regime: 'bullish'|'bearish'|'neutral', market_regime, vol_regime }`
3. **Integration with scan**: Add `--regime-filter` flag that skips tickers where regime is bearish
4. **Journal comparison**: Track win rate with/without regime filter to measure improvement

### Parameters (from PineScript)

| Parameter | Default | Purpose |
|-----------|---------|---------|
| ATR Period | 26 | Lookback for volatility measurement |
| Multiplier | 3.7 | Band distance from price (higher = fewer signals, stronger trends) |
| Source | Low | Price source for band calculation |
| Fast ATR Period | 10 | Optional early exit (tighter bands) |
| Fast Multiplier | 1.5 | Optional early exit sensitivity |

### Incremental Build Order

1. Implement `computeSuperTrend()` as a pure indicator function
2. Add to `IndicatorCache` for pre-computation during tuning
3. Create `regime-detector.ts` that runs SuperTrend on each ticker + SPY
4. Add `--regime-filter` to scan command (only show signals where regime = bullish)
5. Add regime state to scan-summary output (show regime badge per ticker)
6. Track journal win rate split by regime alignment
7. (Future) Tune SuperTrend parameters per ticker like existing strategies

## Layer 3: Ranking — Design Notes

### Composite Score Formula (future)

```
composite_score = (
  w1 × confidence_score +        // existing (0–1)
  w2 × regime_alignment +        // 1 if regime bullish, 0 if bearish
  w3 × signal_overlap +          // 1 if both strategies fire, 0.5 if one
  w4 × rr_ratio_normalized +     // R:R / max_R:R across signals
  w5 × oos_sharpe_normalized     // OOS Sharpe from tuning profile
)
```

### Integration

- Ranking happens after Layer 2 produces raw signals
- Only signals that pass Layer 1 regime filter reach the ranker
- Top N signals (by composite score) are presented to the user
- Journal tracks composite score at entry time for later analysis

## Layer 4: Monitoring Enhancements — Design Notes

### Alert Types (future)

| Alert | Trigger | Action |
|-------|---------|--------|
| HOLD | Position progressing normally | No action |
| WATCH | Price approaching stop or extended | Tighten attention |
| REDUCE | Hit partial target (e.g., 1R profit) | Consider taking partial |
| EXIT | Stop hit, target hit, or expired | Close position |

### Integration with Journal

The signal journal already tracks open/won/lost/expired. Future alerts would:
- Compute current R-multiple for open positions daily
- Emit WATCH when R < -0.5 (approaching stop)
- Emit REDUCE when R > 1.0 (partial profit available)
- These appear in the `journal:status` output

## Build Sequence (Recommended)

1. ✅ Signal Journal (Layer 4 — just completed)
2. 🔜 SuperTrend indicator (`src/supertrend.ts`)
3. 🔜 Regime detector + scan filter
4. 🔜 Journal win-rate split by regime (measure improvement)
5. 📋 Signal overlap detection (Layer 3)
6. 📋 Composite ranking score (Layer 3)
7. 📋 Position alerts (Layer 4 enhancement)
8. 📋 Webull execution (Layer 4 — when account ready)
