/**
 * Minimal local API server for testing backtest routes without needing
 * Postgres, Discord, or broker integrations.
 *
 * Usage: npx tsx scripts/local-api.ts
 */

// Stub DATABASE_URL so TokenStore construction doesn't throw
// (broker routes won't be called during backtest testing)
process.env.DATABASE_URL = 'postgres://localhost/stub';

import express from 'express';
import { handleBacktestSummary, handleBacktestDetail } from '../src/web/backtest-routes.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STOCK_TRACKER_HOME = path.join(__dirname, '..');
const PORT = 3001;

const app = express();

// Global CORS
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/backtests', handleBacktestSummary(STOCK_TRACKER_HOME));
app.get('/api/backtests/:ticker', handleBacktestDetail(STOCK_TRACKER_HOME));

app.listen(PORT, () => {
  console.log(`Local API at http://localhost:${PORT}`);
  console.log(`Test: curl http://localhost:${PORT}/api/backtests | python3 -m json.tool | head -40`);
});
