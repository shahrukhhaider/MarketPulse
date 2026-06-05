# Signal Glossary

A reference guide for reading the daily scan notifications posted to Discord.

---

## Signal States

| State | Meaning |
|-------|---------|
| **Active** | Entry conditions met — the trade is live now |
| **Active (Late)** | Signal triggered on a prior day and is still valid |
| **Near** | Approaching entry conditions — watch for trigger |

---

## Strategies

### Consolidation Breakout
Stock breaks out of a tight trading range (base) on elevated volume. The tighter and longer the base, the more explosive the breakout tends to be.

**Active**: Broke out of a tight base on elevated volume. Price cleared resistance with conviction.
**Near**: Forming a tight base near resistance — watching for volume breakout.

### Trend Pullback
Stock in an established uptrend pulls back to its rising moving average, then bounces with volume. Classic "buy the dip" in a healthy trend.

**Active**: Pulled back to its rising moving average and is reclaiming momentum. Volume expanding on the bounce.
**Near**: In an uptrend pulling back — watching for a reversal day.

### Keltner Mean Reversion
Stock dips below its lower Keltner Channel band while the broader trend remains up. A "rubber band" play — stretched too far below the mean, now snapping back.

**Active**: Dipped below its Keltner band in an uptrend and is recovering. Stretched below the mean, now reverting.
**Near**: Approaching its lower Keltner band in an uptrend — watching for bounce.

### Bear Breakdown
Stock breaks down from consolidation on volume in a confirmed downtrend. This is a SHORT signal — betting on continued decline.

**Active**: Broke down from consolidation on volume in a downtrend. Support gave way with conviction.
**Near**: Forming a top in a downtrend — watching for breakdown.

### Post-Earnings Drift
Stock gaps up on earnings and builds a tight base afterward. Institutional accumulation following a positive catalyst — momentum continuation play.

**Active**: Gapped up on earnings and is building a tight base. Institutions accumulating after the gap.
**Near**: Post-earnings base forming — watching for breakout.

### Volume Dry-Up (VDU)
Volume contracts to extreme lows while price consolidates in a tight range. A maturing base — the calm before the storm. When volume returns, direction is typically explosive.

**Active**: Consolidating in a tight range with volume at extreme lows. Base is maturing.
**Near**: Volume contracting on tight price action — setup building.

---

## Signal Card Layout

Each active signal card in Discord shows:

```
TICKER — strategy name
🟢 BUY · Day N · Confidence · RS rating · Fundamental badge
Narrative explanation of the setup
Entry $XX.XX → Stop $XX.XX → Target $XX.XX · Risk X.X% · R:R X.X
Vol X.X× · Candlestick patterns (if any)
```

---

## Key Metrics

| Metric | Meaning |
|--------|---------|
| **Entry** | Price level where the trade triggers |
| **Stop** | Exit price if the trade goes wrong (max loss) |
| **Target** | Profit target price |
| **Risk %** | Percentage distance from entry to stop |
| **R:R** | Reward-to-Risk ratio. R:R 2.0 means potential profit is 2× the potential loss |
| **Day N** | How many days the signal has been active |
| **Vol X.X×** | Relative volume — today's volume vs. 20-day average. Vol 2.5× means 2.5 times normal volume |
| **RS** | Relative Strength rating — how the stock performs vs. the market |

---

## Confidence Badges

| Badge | Score Range | Meaning |
|-------|-------------|---------|
| 🔥 High | ≥ 0.80 | Strong setup with multiple confirming factors |
| ★ Good | 0.65 – 0.79 | Solid setup with good alignment |
| ~ Fair | 0.50 – 0.64 | Acceptable setup, fewer confirming factors |
| _(none)_ | < 0.50 | Low confidence — not badged |

---

## Fundamental Badges

| Badge | Tier | Meaning |
|-------|------|---------|
| F 🟢 | Strong | Strong earnings growth, consistent beats, revenue growth |
| F 🟡 | Mixed | Some positive fundamentals, some concerns |
| F 🔴 | Weak | Declining earnings, misses, or revenue contraction |

---

## Market Header

The daily scan header shows overall market conditions:

```
📊 Daily Scan — Monday, June 5, 2026
Mood: 🟢 Bullish   VIX 14.2 (calm)   Breadth 68% (healthy)   SPY ↑  QQQ ↑
Market Trend: Bullish   Exposure: 60–80%  [3 slots used · 5 available]
520 tickers scanned · 3 open positions · P&L +$245.00
```

### Market Mood

| Emoji | Regime | Meaning |
|-------|--------|---------|
| 🟢 | Bullish | Favorable conditions for long positions |
| 🟡 | Neutral | Mixed signals — be selective |
| 🔴 | Bearish | Unfavorable for longs — reduce exposure |

### Exposure Tiers

| Regime | Recommended Exposure | Position Slots |
|--------|---------------------|----------------|
| Bullish | 60–80% | 6–8 positions |
| Neutral | 40–60% | 4–6 positions |
| Bearish | 0–20% | 0–2 positions |

### Trend Arrows

- **SPY ↑** — S&P 500 above its moving average (broad market uptrend)
- **SPY ↓** — S&P 500 below its moving average (broad market downtrend)
- **QQQ ↑/↓** — Same for Nasdaq 100 (tech-heavy index)

---

## Sides

| Icon | Side | Meaning |
|------|------|---------|
| 🟢 | BUY | Long position — profit when price goes up |
| 🔴 | SHORT | Short position — profit when price goes down |

---

## Open Positions Card

Shows current active trades with:
- **Ticker** — stock symbol
- **Strategy abbreviation** (CB = Consolidation Breakout, TP = Trend Pullback, KMR = Keltner Mean Reversion, BB = Bear Breakdown, PED = Post-Earnings Drift, VDU = Volume Dry-Up)
- **P&L %** — unrealized profit/loss percentage
- **Days held** — trading days since entry
- **Progress** — % to target or % from stop

---

## Near Signals Card

Shows setups approaching entry. These aren't trades yet — they're watchlist items that could trigger soon. Format:

```
👀 Near Signals (5)
AAPL — consolidation breakout @ 195.50 — forming a tight base near resistance
MSFT — trend pullback @ 420.00 — in an uptrend pulling back
```

---

## Confluence

When multiple strategies agree on the same ticker, it's marked with:
- **⚑ Multi-strategy** (> 70% confluence) — strongest confirmation
- **⚑ Confirmed** (50–70% confluence) — good confirmation

---

## Quick Reference: Trade Sizing

Each trade uses a fixed $1,000 position size with a maximum of 10 open positions. Trades are automatically resolved when price hits the stop (loss) or target (win), or expires after ~42 trading days.
