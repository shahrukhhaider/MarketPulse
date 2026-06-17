// ============================================================
// Chart Image Generator — orchestrates headless PNG rendering
// ============================================================
// Manages the full pipeline: data fetching → HTML generation →
// Puppeteer headless rendering → PNG buffer output.
// Uses a shared browser instance with a semaphore limiting
// concurrent pages to 3.
// ============================================================

import type { SignalInput, ChartResult, ChartImageGeneratorDeps } from './chart-types.js';
import { generateChartFilename } from './chart-types.js';
import { generateSignalChartHtml } from './formatters/signal-chart-html.js';

/** Maximum number of concurrent browser pages. */
const MAX_CONCURRENT_PAGES = 3;

/** Per-chart timeout in milliseconds (page navigation → screenshot). */
const CHART_TIMEOUT_MS = 30_000;

/** Minimum data points required for chart rendering. */
const MIN_DATA_POINTS = 20;

// ============================================================
// Semaphore for concurrency control
// ============================================================

interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
}

function createSemaphore(maxConcurrency: number): Semaphore {
  let current = 0;
  const queue: Array<() => void> = [];

  return {
    acquire(): Promise<void> {
      if (current < maxConcurrency) {
        current++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    },
    release(): void {
      current--;
      const next = queue.shift();
      if (next) {
        current++;
        next();
      }
    },
  };
}

// ============================================================
// Main export
// ============================================================

/**
 * Generate chart images for a batch of active signals.
 *
 * - Dynamically imports Puppeteer (graceful catch on module-not-found)
 * - Launches a single shared browser instance (headless: true)
 * - Processes signals with max 3 concurrent pages
 * - Returns one ChartResult per signal (success or failure)
 * - Closes browser in finally block after all signals complete
 * - Handles browser disconnect: marks remaining as failed
 */
export async function generateChartImages(
  signals: SignalInput[],
  deps: ChartImageGeneratorDeps
): Promise<ChartResult[]> {
  if (signals.length === 0) {
    return [];
  }

  // Dynamic import: try puppeteer (local dev), fall back to puppeteer-core (production)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppeteerModule: any;
  try {
    const moduleName = 'puppeteer';
    puppeteerModule = await import(moduleName);
  } catch {
    try {
      const coreModuleName = 'puppeteer-core';
      puppeteerModule = await import(coreModuleName);
    } catch (err: unknown) {
      const reason =
        err instanceof Error ? err.message : 'Puppeteer module not available';
      return signals.map((signal) => ({
        success: false as const,
        ticker: signal.ticker,
        strategy: signal.strategy,
        reason: `Puppeteer unavailable: ${reason}`,
      }));
    }
  }

  // Launch shared browser instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;
  let browserDisconnected = false;

  try {
    browser = await puppeteerModule.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // On Railway, puppeteer-core needs the system chromium path
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
    });

    // Listen for browser disconnect
    browser.on('disconnected', () => {
      browserDisconnected = true;
      process.stderr.write(
        '[chart-image-generator] Warning: Browser disconnected unexpectedly\n'
      );
    });

    const semaphore = createSemaphore(MAX_CONCURRENT_PAGES);

    const resultPromises = signals.map((signal) =>
      renderSignalChart(signal, deps, browser!, semaphore, () => browserDisconnected)
    );

    const results = await Promise.allSettled(resultPromises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      // Should not happen since renderSignalChart catches all errors,
      // but handle defensively
      return {
        success: false as const,
        ticker: signals[index].ticker,
        strategy: signals[index].strategy,
        reason: `Unexpected error: ${result.reason}`,
      };
    });
  } catch (err: unknown) {
    // Browser launch failure
    const reason =
      err instanceof Error ? err.message : 'Browser launch failed';
    return signals.map((signal) => ({
      success: false as const,
      ticker: signal.ticker,
      strategy: signal.strategy,
      reason: `Browser launch error: ${reason}`,
    }));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Browser may already be closed/disconnected
      }
    }
  }
}

// ============================================================
// Per-signal chart rendering
// ============================================================

async function renderSignalChart(
  signal: SignalInput,
  deps: ChartImageGeneratorDeps,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browser: any,
  semaphore: Semaphore,
  isBrowserDisconnected: () => boolean
): Promise<ChartResult> {
  const { ticker, strategy, entry, stop, target } = signal;

  // Check browser disconnect before acquiring semaphore
  if (isBrowserDisconnected()) {
    return {
      success: false,
      ticker,
      strategy,
      reason: 'Browser disconnected before processing',
    };
  }

  await semaphore.acquire();

  try {
    // Check again after acquiring semaphore
    if (isBrowserDisconnected()) {
      return {
        success: false,
        ticker,
        strategy,
        reason: 'Browser disconnected before processing',
      };
    }

    // 1. Fetch historical data
    const dataResult = await deps.dataProvider.getHistoricalData(ticker, '3mo', '1d');

    if (!dataResult.success) {
      return {
        success: false,
        ticker,
        strategy,
        reason: `Data fetch error: ${dataResult.error}`,
      };
    }

    const { dataPoints } = dataResult.data;

    // 2. Validate minimum data points
    if (dataPoints.length < MIN_DATA_POINTS) {
      return {
        success: false,
        ticker,
        strategy,
        reason: `Insufficient data: ${dataPoints.length} data points (minimum ${MIN_DATA_POINTS} required)`,
      };
    }

    // 3. Generate HTML
    const html = generateSignalChartHtml(
      { ticker, strategy, dataPoints, entry, stop, target, signalStartDate: signal.signalStartDate, backtestSummary: signal.backtestSummary, historicalTrades: signal.historicalTrades },
      deps.lightweightChartsJs
    );

    // 4. Create page and render with timeout
    const pngBuffer = await renderPageWithTimeout(browser, html);

    // 5. Return success
    const filename = generateChartFilename(ticker, strategy);
    return {
      success: true,
      ticker,
      strategy,
      pngBuffer,
      filename,
    };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      ticker,
      strategy,
      reason,
    };
  } finally {
    semaphore.release();
  }
}

// ============================================================
// Page rendering with timeout
// ============================================================

async function renderPageWithTimeout(
  browser: any,
  html: string
): Promise<Buffer> {
  let page: any = null;

  try {
    page = await browser.newPage();
    await page.setViewport({ width: 800, height: 400 });

    // Race between rendering and timeout
    const pngBuffer = await Promise.race([
      renderPage(page, html),
      createTimeout(CHART_TIMEOUT_MS),
    ]);

    return pngBuffer;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Page may already be closed
      }
    }
  }
}

async function renderPage(page: any, html: string): Promise<Buffer> {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  // Wait for the data-chart-ready attribute on body (runs in browser context)
  await page.waitForFunction(
    'document.body.getAttribute("data-chart-ready") === "true"',
    { timeout: CHART_TIMEOUT_MS }
  );

  // Capture screenshot as PNG buffer
  const screenshot = await page.screenshot({
    type: 'png',
    fullPage: false,
    clip: { x: 0, y: 0, width: 800, height: 400 },
  });

  return Buffer.from(screenshot);
}

function createTimeout(ms: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Chart rendering timed out after ${ms}ms`));
    }, ms);
  });
}
