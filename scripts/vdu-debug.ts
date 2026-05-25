/**
 * Debug script: check why VDU engine finds no ACTIVE signals in AAPL data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VduEngine, detectDirection, detectBaseFormation, detectVolumeDryUp, classifyState, DEFAULT_VDU_CONFIG } from '../src/strategies/vdu-engine.js';
import type { HistoricalDataPoint } from '../src/types.js';

const DATA_DIR = join(process.cwd(), '.stock-tracker');
const cachePath = join(DATA_DIR, 'history-cache', 'AAPL_5y.json');

let data: HistoricalDataPoint[];
try {
  const raw = readFileSync(cachePath, 'utf-8');
  data = JSON.parse(raw).dataPoints;
} catch (e) {
  console.log('No cached data for AAPL. Run the backtest script first.');
  process.exit(0);
}

console.log('AAPL data points:', data.length);
console.log('Date range:', data[0]?.date, '→', data[data.length - 1]?.date);

// Check how many bars pass direction phase
let directionPassed = 0;
let basePassed = 0;
let volumePassed = 0;
let stateForming = 0;
let stateNear = 0;
let stateActive = 0;

const config = DEFAULT_VDU_CONFIG;

for (let i = 51; i < data.length; i++) {
  if (!detectDirection(data, i)) continue;
  directionPassed++;

  const baseMetrics = detectBaseFormation(data, i, {
    consolidation_window: config.consolidation_window,
    proximity_to_highs_pct: config.proximity_to_highs_pct,
    atr_ratio_threshold: config.atr_ratio_threshold,
  });

  if (baseMetrics.range_pct === 0 && baseMetrics.atr_ratio === 0) continue;
  basePassed++;

  const volumeMetrics = detectVolumeDryUp(
    data, i,
    { volume_lookback: config.volume_lookback, min_declining_days: config.min_declining_days },
    config.volume_threshold_forming
  );

  if (volumeMetrics.volume_ratio === 0) continue;
  volumePassed++;

  const state = classifyState(baseMetrics, volumeMetrics, {
    max_range_pct: config.max_range_pct,
    near_range_pct: config.near_range_pct,
    active_range_pct: config.active_range_pct,
    atr_ratio_threshold: config.atr_ratio_threshold,
    near_atr_ratio: config.near_atr_ratio,
    active_atr_ratio: config.active_atr_ratio,
    proximity_to_highs_pct: config.proximity_to_highs_pct,
    volume_threshold_forming: config.volume_threshold_forming,
    volume_threshold_near: config.volume_threshold_near,
    volume_threshold_active: config.volume_threshold_active,
  });

  if (state === 'forming') stateForming++;
  if (state === 'near') stateNear++;
  if (state === 'active') stateActive++;

  // Print first few signals for debugging
  if (state !== 'none' && (stateForming + stateNear + stateActive) <= 5) {
    console.log(`  Bar ${i} (${data[i].date}): state=${state}`);
    console.log(`    range_pct=${baseMetrics.range_pct.toFixed(2)}%, prox=${baseMetrics.proximity_to_highs.toFixed(2)}%, atr_ratio=${baseMetrics.atr_ratio.toFixed(3)}`);
    console.log(`    vol_ratio=${volumeMetrics.volume_ratio.toFixed(3)}, vol_slope=${volumeMetrics.volume_slope.toFixed(0)}, met=${volumeMetrics.met}`);
  }
}

console.log('\nPipeline funnel (default config):');
console.log(`  Total bars evaluated: ${data.length - 51}`);
console.log(`  Direction passed:     ${directionPassed}`);
console.log(`  Base metrics valid:   ${basePassed}`);
console.log(`  Volume metrics valid: ${volumePassed}`);
console.log(`  State FORMING:        ${stateForming}`);
console.log(`  State NEAR:           ${stateNear}`);
console.log(`  State ACTIVE:         ${stateActive}`);
