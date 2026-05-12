#!/usr/bin/env python3
"""
Webull Paper Trading Integration
=================================
Manages paper trades via Webull OpenAPI.

Subcommands:
  enter   - Place buy orders for active signals
  update  - Check open positions, close if stop/target hit
  status  - Show current positions and P&L
  close   - Sell a specific position

Configuration:
  Reads from .stock-tracker/webull-config.json:
  {
    "app_key": "...",
    "app_secret": "...",
    "account_id": "...",
    "environment": "test"  // "test" or "production"
  }

Rules:
  - Portfolio: $10,000
  - Per trade: 10% ($1,000)
  - Max open positions: 10
"""

import json
import sys
import os
import uuid
from pathlib import Path
from datetime import datetime

# ============================================================
# Configuration
# ============================================================

PORTFOLIO_VALUE = 10000
TRADE_PCT = 0.10  # 10% per trade
MAX_POSITIONS = 10
TRADE_AMOUNT = PORTFOLIO_VALUE * TRADE_PCT  # $1,000

def get_data_dir():
    """Resolve the .stock-tracker data directory."""
    home = os.environ.get('STOCK_TRACKER_HOME', os.getcwd())
    return os.path.join(home, '.stock-tracker')

def load_config():
    """Load Webull API configuration."""
    data_dir = get_data_dir()
    config_path = os.path.join(data_dir, 'webull-config.json')
    
    if not os.path.exists(config_path):
        return None
    
    with open(config_path, 'r') as f:
        return json.load(f)

def load_positions():
    """Load local position tracking file."""
    data_dir = get_data_dir()
    positions_path = os.path.join(data_dir, 'paper-positions.json')
    
    if not os.path.exists(positions_path):
        return {"open": [], "closed": [], "created_at": datetime.now().isoformat()}
    
    with open(positions_path, 'r') as f:
        return json.load(f)

def save_positions(positions):
    """Save local position tracking file."""
    data_dir = get_data_dir()
    positions_path = os.path.join(data_dir, 'paper-positions.json')
    
    with open(positions_path, 'w') as f:
        json.dump(positions, f, indent=2)

# ============================================================
# Webull Client Wrapper
# ============================================================

class WebullClient:
    """Thin wrapper around Webull OpenAPI SDK."""
    
    def __init__(self, config):
        self.config = config
        self.client = None
        self.trade_client = None
        self._connect()
    
    def _connect(self):
        """Initialize the Webull SDK client."""
        try:
            from webull.core.client import ApiClient
            from webull.trade.trade_client import TradeClient
        except ImportError:
            print(json.dumps({
                "success": False,
                "error": "Webull SDK not installed. Run: pip3 install webull-openapi-python-sdk"
            }))
            sys.exit(1)
        
        env = self.config.get('environment', 'test')
        region = "us"
        
        self.client = ApiClient(
            self.config['app_key'],
            self.config['app_secret'],
            region
        )
        
        if env == 'test':
            self.client.add_endpoint("us", "us-openapi-alb.uat.webullbroker.com")
        else:
            self.client.add_endpoint("us", "api.webull.com")
        
        self.trade_client = TradeClient(self.client)
    
    def get_account_id(self):
        """Get the configured account ID."""
        return self.config['account_id']
    
    def place_market_buy(self, ticker, quantity):
        """Place a market buy order."""
        account_id = self.get_account_id()
        client_order_id = uuid.uuid4().hex
        
        orders = [{
            "combo_type": "NORMAL",
            "client_order_id": client_order_id,
            "symbol": ticker,
            "instrument_type": "EQUITY",
            "market": "US",
            "order_type": "MARKET",
            "quantity": str(quantity),
            "support_trading_session": "CORE",
            "side": "BUY",
            "time_in_force": "DAY",
            "entrust_type": "QTY"
        }]
        
        res = self.trade_client.order_v2.place_order(account_id, orders)
        return {
            "status_code": res.status_code,
            "data": res.json() if res.status_code == 200 else None,
            "error": res.text if res.status_code != 200 else None,
            "client_order_id": client_order_id
        }
    
    def place_market_sell(self, ticker, quantity):
        """Place a market sell order."""
        account_id = self.get_account_id()
        client_order_id = uuid.uuid4().hex
        
        orders = [{
            "combo_type": "NORMAL",
            "client_order_id": client_order_id,
            "symbol": ticker,
            "instrument_type": "EQUITY",
            "market": "US",
            "order_type": "MARKET",
            "quantity": str(quantity),
            "support_trading_session": "CORE",
            "side": "SELL",
            "time_in_force": "DAY",
            "entrust_type": "QTY"
        }]
        
        res = self.trade_client.order_v2.place_order(account_id, orders)
        return {
            "status_code": res.status_code,
            "data": res.json() if res.status_code == 200 else None,
            "error": res.text if res.status_code != 200 else None,
            "client_order_id": client_order_id
        }
    
    def get_positions(self):
        """Get current account positions."""
        account_id = self.get_account_id()
        res = self.trade_client.account_v2.get_account_positions(account_id)
        if res.status_code == 200:
            return res.json()
        return None
    
    def get_account_balance(self):
        """Get account balance."""
        account_id = self.get_account_id()
        res = self.trade_client.account_v2.get_account_balance(account_id)
        if res.status_code == 200:
            return res.json()
        return None

# ============================================================
# Commands
# ============================================================

def cmd_enter(signals_json):
    """
    Enter positions for active signals.
    
    Input: JSON string with array of active signals from scan output.
    Each signal: { ticker, strategy, entry, stop, target, risk_pct, confidence }
    """
    config = load_config()
    if not config:
        print(json.dumps({
            "success": False,
            "error": "No webull-config.json found. Create .stock-tracker/webull-config.json with app_key, app_secret, account_id"
        }))
        return
    
    signals = json.loads(signals_json)
    positions = load_positions()
    
    # Count current open positions
    open_count = len(positions['open'])
    available_slots = MAX_POSITIONS - open_count
    
    if available_slots <= 0:
        print(json.dumps({
            "success": True,
            "action": "enter",
            "message": f"Max positions reached ({MAX_POSITIONS}). No new entries.",
            "opened": []
        }))
        return
    
    # Filter signals: skip if already have open position for same ticker
    open_tickers = {p['ticker'] for p in positions['open']}
    new_signals = [s for s in signals if s['ticker'] not in open_tickers]
    
    # Limit to available slots
    to_enter = new_signals[:available_slots]
    
    client = WebullClient(config)
    opened = []
    errors = []
    
    for signal in to_enter:
        ticker = signal['ticker']
        entry_price = signal['entry']
        
        # Calculate shares: $1,000 / entry price
        shares = int(TRADE_AMOUNT / entry_price)
        if shares < 1:
            errors.append(f"{ticker}: price ${entry_price} too high for $1,000 allocation")
            continue
        
        # Place market buy
        result = client.place_market_buy(ticker, shares)
        
        if result['status_code'] == 200:
            # Record position locally (for stop/target tracking)
            position = {
                "id": result['client_order_id'],
                "ticker": ticker,
                "strategy": signal.get('strategy', 'unknown'),
                "shares": shares,
                "entry_price": entry_price,
                "entry_date": datetime.now().strftime('%Y-%m-%d'),
                "stop_loss": signal['stop'],
                "profit_target": signal.get('target', entry_price * 1.1),
                "risk_pct": signal.get('risk_pct', 0),
                "confidence": signal.get('confidence', 0),
                "order_id": result.get('client_order_id'),
                "notional": shares * entry_price
            }
            positions['open'].append(position)
            opened.append(position)
        else:
            errors.append(f"{ticker}: order failed — {result.get('error', 'unknown error')}")
    
    save_positions(positions)
    
    print(json.dumps({
        "success": True,
        "action": "enter",
        "opened": opened,
        "errors": errors,
        "open_count": len(positions['open']),
        "available_slots": MAX_POSITIONS - len(positions['open'])
    }, indent=2))


def cmd_update():
    """
    Check open positions against current prices.
    Close positions where stop or target is hit.
    """
    config = load_config()
    if not config:
        print(json.dumps({"success": False, "error": "No webull-config.json found"}))
        return
    
    positions = load_positions()
    
    if not positions['open']:
        print(json.dumps({
            "success": True,
            "action": "update",
            "message": "No open positions",
            "open": 0,
            "closed": 0
        }))
        return
    
    client = WebullClient(config)
    
    # Get current positions from Webull to get live prices
    webull_positions = client.get_positions()
    
    # Build price map from Webull positions
    price_map = {}
    if webull_positions:
        for wp in webull_positions if isinstance(webull_positions, list) else webull_positions.get('positions', []):
            symbol = wp.get('ticker', {}).get('symbol', '') if isinstance(wp.get('ticker'), dict) else wp.get('symbol', '')
            last_price = float(wp.get('lastPrice', 0) or wp.get('last_price', 0) or 0)
            if symbol and last_price > 0:
                price_map[symbol] = last_price
    
    closed_positions = []
    still_open = []
    today = datetime.now().strftime('%Y-%m-%d')
    
    for pos in positions['open']:
        ticker = pos['ticker']
        current_price = price_map.get(ticker)
        
        if current_price is None:
            # Can't check — keep open
            still_open.append(pos)
            continue
        
        # Check stop loss
        if current_price <= pos['stop_loss']:
            # Sell at market
            result = client.place_market_sell(ticker, pos['shares'])
            pos['exit_price'] = current_price
            pos['exit_date'] = today
            pos['exit_reason'] = 'stop_loss'
            pos['pnl'] = (current_price - pos['entry_price']) * pos['shares']
            pos['pnl_pct'] = ((current_price - pos['entry_price']) / pos['entry_price']) * 100
            positions['closed'].append(pos)
            closed_positions.append(pos)
            continue
        
        # Check profit target
        if current_price >= pos['profit_target']:
            # Sell at market
            result = client.place_market_sell(ticker, pos['shares'])
            pos['exit_price'] = current_price
            pos['exit_date'] = today
            pos['exit_reason'] = 'profit_target'
            pos['pnl'] = (current_price - pos['entry_price']) * pos['shares']
            pos['pnl_pct'] = ((current_price - pos['entry_price']) / pos['entry_price']) * 100
            positions['closed'].append(pos)
            closed_positions.append(pos)
            continue
        
        # Still open — update unrealized P&L
        pos['current_price'] = current_price
        pos['unrealized_pnl'] = (current_price - pos['entry_price']) * pos['shares']
        pos['unrealized_pct'] = ((current_price - pos['entry_price']) / pos['entry_price']) * 100
        still_open.append(pos)
    
    positions['open'] = still_open
    save_positions(positions)
    
    print(json.dumps({
        "success": True,
        "action": "update",
        "open": len(still_open),
        "closed": [{
            "ticker": p['ticker'],
            "reason": p['exit_reason'],
            "pnl": round(p['pnl'], 2),
            "pnl_pct": round(p['pnl_pct'], 2)
        } for p in closed_positions],
        "positions": [{
            "ticker": p['ticker'],
            "entry": p['entry_price'],
            "current": p.get('current_price', p['entry_price']),
            "stop": p['stop_loss'],
            "target": p['profit_target'],
            "shares": p['shares'],
            "unrealized_pnl": round(p.get('unrealized_pnl', 0), 2),
            "unrealized_pct": round(p.get('unrealized_pct', 0), 2)
        } for p in still_open]
    }, indent=2))


def cmd_status():
    """Show portfolio status."""
    positions = load_positions()
    
    open_positions = positions['open']
    closed_positions = positions['closed']
    
    total_realized_pnl = sum(p.get('pnl', 0) for p in closed_positions)
    total_unrealized_pnl = sum(p.get('unrealized_pnl', 0) for p in open_positions)
    wins = len([p for p in closed_positions if p.get('pnl', 0) > 0])
    losses = len([p for p in closed_positions if p.get('pnl', 0) <= 0])
    win_rate = wins / len(closed_positions) * 100 if closed_positions else 0
    
    open_exposure = sum(p.get('notional', 0) for p in open_positions)
    
    print(json.dumps({
        "success": True,
        "action": "status",
        "portfolio": {
            "starting_capital": PORTFOLIO_VALUE,
            "realized_pnl": round(total_realized_pnl, 2),
            "unrealized_pnl": round(total_unrealized_pnl, 2),
            "total_pnl": round(total_realized_pnl + total_unrealized_pnl, 2),
            "win_rate": round(win_rate, 1),
            "total_trades": len(closed_positions),
            "wins": wins,
            "losses": losses,
            "open_positions": len(open_positions),
            "open_exposure": round(open_exposure, 2),
            "available_slots": MAX_POSITIONS - len(open_positions)
        },
        "open": [{
            "ticker": p['ticker'],
            "strategy": p.get('strategy', ''),
            "entry": p['entry_price'],
            "current": p.get('current_price', p['entry_price']),
            "stop": p['stop_loss'],
            "target": p['profit_target'],
            "shares": p['shares'],
            "entry_date": p['entry_date'],
            "unrealized_pnl": round(p.get('unrealized_pnl', 0), 2)
        } for p in open_positions],
        "recent_closed": [{
            "ticker": p['ticker'],
            "entry": p['entry_price'],
            "exit": p.get('exit_price', 0),
            "reason": p.get('exit_reason', ''),
            "pnl": round(p.get('pnl', 0), 2),
            "pnl_pct": round(p.get('pnl_pct', 0), 2),
            "exit_date": p.get('exit_date', '')
        } for p in closed_positions[-10:]]
    }, indent=2))


def cmd_close(ticker, price=None):
    """Manually close a position."""
    config = load_config()
    if not config:
        print(json.dumps({"success": False, "error": "No webull-config.json found"}))
        return
    
    positions = load_positions()
    
    # Find the open position for this ticker
    target = None
    for p in positions['open']:
        if p['ticker'].upper() == ticker.upper():
            target = p
            break
    
    if not target:
        print(json.dumps({
            "success": False,
            "error": f"No open position for {ticker.upper()}"
        }))
        return
    
    client = WebullClient(config)
    result = client.place_market_sell(target['ticker'], target['shares'])
    
    exit_price = float(price) if price else target.get('current_price', target['entry_price'])
    today = datetime.now().strftime('%Y-%m-%d')
    
    target['exit_price'] = exit_price
    target['exit_date'] = today
    target['exit_reason'] = 'manual'
    target['pnl'] = (exit_price - target['entry_price']) * target['shares']
    target['pnl_pct'] = ((exit_price - target['entry_price']) / target['entry_price']) * 100
    
    positions['open'] = [p for p in positions['open'] if p['ticker'] != target['ticker']]
    positions['closed'].append(target)
    save_positions(positions)
    
    print(json.dumps({
        "success": True,
        "action": "close",
        "position": {
            "ticker": target['ticker'],
            "entry": target['entry_price'],
            "exit": exit_price,
            "pnl": round(target['pnl'], 2),
            "pnl_pct": round(target['pnl_pct'], 2),
            "reason": "manual"
        }
    }, indent=2))


# ============================================================
# Main
# ============================================================

def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: webull-trade.py <enter|update|status|close> [args]"
        }))
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'enter':
        if len(sys.argv) < 3:
            print(json.dumps({"success": False, "error": "enter requires signals JSON as argument"}))
            sys.exit(1)
        cmd_enter(sys.argv[2])
    
    elif command == 'update':
        cmd_update()
    
    elif command == 'status':
        cmd_status()
    
    elif command == 'close':
        if len(sys.argv) < 3:
            print(json.dumps({"success": False, "error": "close requires ticker argument"}))
            sys.exit(1)
        price = sys.argv[3] if len(sys.argv) > 3 else None
        cmd_close(sys.argv[2], price)
    
    else:
        print(json.dumps({
            "success": False,
            "error": f"Unknown command '{command}'. Use: enter, update, status, close"
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
