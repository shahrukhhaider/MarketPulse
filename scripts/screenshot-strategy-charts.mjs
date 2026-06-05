/**
 * Screenshot Strategy Charts for Documentation
 * 
 * Takes PNG screenshots of representative backtest/scan HTML charts
 * and saves them to docs/images/ for use in the strategy guide.
 */

import puppeteer from 'puppeteer';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const CHARTS_DIR = path.join(PROJECT_DIR, '.stock-tracker');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'docs', 'images');

// Representative charts for each strategy type
const CHARTS = {
  // Combined V3 backtests (consolidation_breakout + trend_pullback)
  'backtest-nvda': 'NVDA_backtest_1779077052118.html',
  'backtest-hood': 'HOOD_backtest_1778957727220.html',
  'backtest-googl': 'GOOGL_backtest_1779078027565.html',
  // VDU (Volume Dry-Up) strategy
  'backtest-vdu-aapl': 'AAPL_VDU_backtest_1779604143896.html',
  'backtest-vdu-nvda': 'NVDA_VDU_backtest_1779603548133.html',
  // Scan charts (signal overlay on recent price action)
  'scan-googl': 'GOOGL_scan_1777440603716.html',
  'scan-tsla': 'TSLA_scan_1777433902712.html',
};

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const [name, filename] of Object.entries(CHARTS)) {
    const htmlPath = path.join(CHARTS_DIR, filename);
    if (!fs.existsSync(htmlPath)) {
      console.log(`⚠ Skipping ${name}: file not found (${filename})`);
      continue;
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for lightweight-charts to render
    await new Promise(r => setTimeout(r, 2000));

    const outputPath = path.join(OUTPUT_DIR, `${name}.png`);
    await page.screenshot({ path: outputPath, fullPage: true });
    await page.close();

    console.log(`✓ ${name}.png`);
  }

  await browser.close();
  console.log(`\nDone. Screenshots saved to docs/images/`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
