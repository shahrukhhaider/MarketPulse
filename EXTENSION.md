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
