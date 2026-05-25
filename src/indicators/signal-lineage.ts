// ============================================================
// Signal Lineage — Temporal Context & Confidence Adjustment
// ============================================================
//
// Computes temporal context for a signal by reading the signal
// history log and produces a bounded confidence adjustment.
//
// Pure function: deterministic for a given input + history file.
// Follows the same pattern as candlestick-scorer.ts and
// confluence-calculator.ts.
// ============================================================

import { readFileSync } from 'fs';

// ============================================================
// Exported Interfaces
// ============================================================

/** Input to the lineage computation */
export interface LineageInput {
  ticker: string;
  strategy: string;
  currentState: string;       // "active" | "near" | "forming" | "none"
  currentMood: string;        // today's market_mood
  historyPath: string;        // absolute path to signal-history.ndjson
  today?: string;             // ISO date string (default: new Date().toISOString().slice(0,10))
}

/** Output of the lineage computation */
export interface SignalLineage {
  daysInState: number;              // consecutive days in current state (min 1)
  progressionPath: string;          // e.g. "FORMING(5d) → NEAR(2d) → ACTIVE"
  textbookProgression: boolean;     // FORMING → NEAR → ACTIVE with no gaps
  priorFailedAttempt: boolean;      // was active then disappeared within 3 days
  priorAttemptDaysAgo: number | null; // days since the failed attempt
  regimeShift: boolean;             // market_mood changed since first appearance
  adjustment: number;               // [0.85, 1.15] composite multiplier
  preceded_by_vdu: boolean;         // CB ACTIVE preceded by VDU NEAR/ACTIVE within 5 entries
}

// ============================================================
// Neutral result constant
// ============================================================

/** Neutral result returned on errors or missing data */
export const NEUTRAL_LINEAGE: SignalLineage = {
  daysInState: 1,
  progressionPath: '',
  textbookProgression: false,
  priorFailedAttempt: false,
  priorAttemptDaysAgo: null,
  regimeShift: false,
  adjustment: 1.0,
  preceded_by_vdu: false,
};

// ============================================================
// Internal Types
// ============================================================

/** Signal state on a given day for a ticker + strategy */
type SignalState = 'active' | 'near' | 'none';

/** A day's state in the timeline */
interface TimelineDay {
  date: string;
  state: SignalState;
  marketMood: string;
}

/** A compressed segment of consecutive same-state days */
interface PathSegment {
  state: SignalState;
  count: number;
}

// ============================================================
// History Loading
// ============================================================

/**
 * Load and parse signal history from the NDJSON file.
 * Returns up to 20 entries sorted by date descending, excluding today.
 */
function loadHistory(historyPath: string, today: string): Array<{ date: string; active: Array<{ ticker: string; strategy: string }>; near: Array<{ ticker: string; strategy: string }>; market_context: { market_mood: string } }> {
  const content = readFileSync(historyPath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  const entries: Array<{ date: string; active: Array<{ ticker: string; strategy: string }>; near: Array<{ ticker: string; strategy: string }>; market_context: { market_mood: string } }> = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.date) {
        entries.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Filter out today's date
  const filtered = entries.filter((e) => e.date !== today);

  // Sort by date descending (lexicographic on ISO date strings)
  filtered.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

  // Take at most 20
  return filtered.slice(0, 20);
}

// ============================================================
// Timeline Construction
// ============================================================

/**
 * Classify each history entry as active/near/none for the given ticker+strategy.
 */
function buildTimeline(
  entries: Array<{ date: string; active: Array<{ ticker: string; strategy: string }>; near: Array<{ ticker: string; strategy: string }>; market_context: { market_mood: string } }>,
  ticker: string,
  strategy: string
): TimelineDay[] {
  return entries.map((entry) => {
    const inActive = (entry.active || []).some(
      (s) => s.ticker === ticker && s.strategy === strategy
    );
    const inNear = (entry.near || []).some(
      (s) => s.ticker === ticker && s.strategy === strategy
    );

    let state: SignalState;
    if (inActive) {
      state = 'active';
    } else if (inNear) {
      state = 'near';
    } else {
      state = 'none';
    }

    return {
      date: entry.date,
      state,
      marketMood: entry.market_context?.market_mood ?? 'unknown',
    };
  });
}

// ============================================================
// Days-in-State Computation
// ============================================================

/**
 * Count consecutive days from most recent where state matches currentState.
 * Returns count + 1 (for today).
 */
function computeDaysInState(timeline: TimelineDay[], currentState: string): number {
  let count = 0;
  for (const day of timeline) {
    if (day.state === currentState) {
      count++;
    } else {
      break;
    }
  }
  return count + 1; // +1 for today
}

// ============================================================
// Progression Path Computation
// ============================================================

/**
 * Compute the progression path string from the timeline.
 * Reverses to chronological, filters leading "none" days,
 * compresses segments, appends today's state.
 */
function computeProgressionPath(timeline: TimelineDay[], currentState: string): { path: string; segments: PathSegment[] } {
  // Reverse to chronological order
  const chronological = [...timeline].reverse();

  // Filter out leading "none" days (before first appearance)
  let startIdx = 0;
  while (startIdx < chronological.length && chronological[startIdx].state === 'none') {
    startIdx++;
  }
  const relevant = chronological.slice(startIdx);

  // Compress consecutive same-state days into segments
  const segments: PathSegment[] = [];
  for (const day of relevant) {
    if (segments.length > 0 && segments[segments.length - 1].state === day.state) {
      segments[segments.length - 1].count++;
    } else {
      segments.push({ state: day.state, count: 1 });
    }
  }

  // Append today's state as final segment (merge if same as last)
  const todayState = currentState as SignalState;
  if (segments.length > 0 && segments[segments.length - 1].state === todayState) {
    segments[segments.length - 1].count++;
  } else {
    segments.push({ state: todayState, count: 1 });
  }

  // Format: STATE(Nd) or STATE if count is 1
  const formatted = segments.map((s) => {
    const label = s.state.toUpperCase();
    return s.count > 1 ? `${label}(${s.count}d)` : label;
  });

  return { path: formatted.join(' → '), segments };
}

// ============================================================
// Textbook Progression Detection
// ============================================================

/**
 * Check if the progression follows FORMING → NEAR → ACTIVE
 * in strict sequential order with no "none" gaps between them.
 *
 * Note: "forming" is mapped to "none" in our state classification
 * (since the history only has active/near arrays). However, per the
 * design doc, we check for the pattern in the segments. Since the
 * history file doesn't track "forming" state explicitly (only active
 * and near are recorded), we look for NEAR → ACTIVE with no "none"
 * gaps as the practical textbook progression.
 *
 * Actually, re-reading the requirements: the progression path uses
 * the states as classified from history (active/near/none). The
 * textbook progression is FORMING → NEAR → ACTIVE. Since "forming"
 * doesn't appear in our timeline (it maps to "none" because forming
 * signals aren't in active[] or near[]), we need to interpret this
 * requirement carefully.
 *
 * Per the design doc Step 5: "Walk segments: find FORMING, then NEAR
 * after it, then ACTIVE after that, with no 'none' segments between
 * any of them."
 *
 * Since our state classification only produces active/near/none, and
 * the currentState input can be "forming", we check if the non-"none"
 * state sequence in the segments (including today) contains the pattern
 * where we see near followed by active with no none gaps between them.
 *
 * Simplified: textbook progression is true when the segments (excluding
 * "none") show a path that goes through NEAR then ACTIVE without any
 * "none" gaps between them.
 */
function detectTextbookProgression(segments: PathSegment[]): boolean {
  // Walk segments looking for NEAR followed by ACTIVE with no "none" between
  let foundNear = false;

  for (const seg of segments) {
    if (seg.state === 'none') {
      // A "none" gap after finding "near" breaks the textbook pattern
      if (foundNear) {
        return false;
      }
    } else if (seg.state === 'near') {
      foundNear = true;
    } else if (seg.state === 'active') {
      if (foundNear) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================
// Prior Failed Attempt Detection
// ============================================================

/**
 * Detect if there was a prior failed attempt: the ticker+strategy was
 * "active" and then disappeared (state became "none") within 3 calendar days.
 *
 * Returns the most recent failed attempt if multiple exist.
 */
function detectPriorFailedAttempt(
  timeline: TimelineDay[],
  today: string
): { priorFailedAttempt: boolean; priorAttemptDaysAgo: number | null } {
  // Timeline is in date descending order
  // We need to check chronological order for "active then none within 3 days"
  const chronological = [...timeline].reverse();

  let mostRecentFailedDate: string | null = null;

  for (let i = 0; i < chronological.length; i++) {
    if (chronological[i].state !== 'active') continue;

    // Check if within 3 calendar days after this active day, state becomes "none"
    const activeDate = chronological[i].date;

    for (let j = i + 1; j < chronological.length; j++) {
      const daysDiff = daysBetween(activeDate, chronological[j].date);

      if (daysDiff > 3) break; // Beyond 3 calendar days

      if (chronological[j].state === 'none') {
        // Found a failed attempt
        if (
          mostRecentFailedDate === null ||
          activeDate > mostRecentFailedDate
        ) {
          mostRecentFailedDate = activeDate;
        }
        break;
      }
    }
  }

  if (mostRecentFailedDate === null) {
    return { priorFailedAttempt: false, priorAttemptDaysAgo: null };
  }

  const daysAgo = daysBetween(mostRecentFailedDate, today);
  return { priorFailedAttempt: true, priorAttemptDaysAgo: daysAgo };
}

/**
 * Compute the number of calendar days between two ISO date strings.
 */
function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================
// Regime Consistency Check
// ============================================================

/**
 * Check if the market mood has changed since the ticker+strategy first appeared.
 * Finds the earliest day where state !== "none" and compares its mood to currentMood.
 */
function detectRegimeShift(timeline: TimelineDay[], currentMood: string): boolean {
  // Timeline is date descending — earliest appearance is at the end
  // Walk from the end to find the earliest day where state !== "none"
  let earliestAppearance: TimelineDay | null = null;

  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].state !== 'none') {
      earliestAppearance = timeline[i];
      break;
    }
  }

  if (earliestAppearance === null) {
    return false;
  }

  return earliestAppearance.marketMood !== currentMood;
}

// ============================================================
// Composite Adjustment Computation
// ============================================================

/**
 * Compute the composite confidence adjustment from all metrics.
 * Multiplies applicable rules together and clamps to [0.85, 1.15].
 */
function computeAdjustment(
  textbookProgression: boolean,
  daysInState: number,
  currentState: string,
  priorFailedAttempt: boolean,
  priorAttemptDaysAgo: number | null,
  regimeShift: boolean
): number {
  let composite = 1.0;

  // Rule 1: textbook progression → 1.08
  if (textbookProgression) {
    composite *= 1.08;
  }

  // Rule 2: stale near (daysInState > 7 AND currentState is "near") → 0.93
  if (daysInState > 7 && currentState === 'near') {
    composite *= 0.93;
  }

  // Rule 3 & 4: prior failed attempt (mutually exclusive ranges)
  if (priorFailedAttempt && priorAttemptDaysAgo !== null) {
    if (priorAttemptDaysAgo < 10) {
      composite *= 0.85;
    } else if (priorAttemptDaysAgo >= 10 && priorAttemptDaysAgo <= 20) {
      composite *= 0.93;
    }
  }

  // Rule 5: regime shift → 0.92
  if (regimeShift) {
    composite *= 0.92;
  }

  // Clamp to [0.85, 1.15]
  return Math.max(0.85, Math.min(1.15, composite));
}

// ============================================================
// VDU Precedence Detection (for CB lineage)
// ============================================================

/**
 * Detect if a CB ACTIVE signal was preceded by a VDU NEAR or ACTIVE signal
 * for the same ticker within the previous 5 calendar entries.
 *
 * Searches the signal-history.ndjson entries for the ticker appearing with
 * strategy "volume_dry_up" in the `active` or `near` arrays.
 *
 * @param entries - History entries (date descending, excluding today)
 * @param ticker - The ticker to search for
 * @returns true if VDU NEAR or ACTIVE found within 5 entries
 */
function detectPrecededByVdu(
  entries: Array<{ date: string; active: Array<{ ticker: string; strategy: string }>; near: Array<{ ticker: string; strategy: string }>; market_context: { market_mood: string } }>,
  ticker: string
): boolean {
  // Search only the most recent 5 entries
  const lookback = Math.min(5, entries.length);

  for (let i = 0; i < lookback; i++) {
    const entry = entries[i];

    // Check if ticker appears with strategy "volume_dry_up" in active array
    const inActive = (entry.active || []).some(
      (s) => s.ticker === ticker && s.strategy === 'volume_dry_up'
    );
    if (inActive) return true;

    // Check if ticker appears with strategy "volume_dry_up" in near array
    const inNear = (entry.near || []).some(
      (s) => s.ticker === ticker && s.strategy === 'volume_dry_up'
    );
    if (inNear) return true;
  }

  return false;
}

// ============================================================
// Main Exported Function
// ============================================================

/**
 * Compute signal lineage from history.
 *
 * @param input - LineageInput with ticker, strategy, current state, mood, and history path
 * @returns SignalLineage with temporal metrics and confidence adjustment
 */
export function computeLineage(input: LineageInput): SignalLineage {
  try {
    const today = input.today ?? new Date().toISOString().slice(0, 10);

    // Step 1: Load history
    const entries = loadHistory(input.historyPath, today);

    // No history → neutral
    if (entries.length === 0) {
      return { ...NEUTRAL_LINEAGE };
    }

    // Step 2: Build timeline
    const timeline = buildTimeline(entries, input.ticker, input.strategy);

    // Check if ticker+strategy appears at all
    const hasAppearance = timeline.some((d) => d.state !== 'none');
    if (!hasAppearance) {
      return { ...NEUTRAL_LINEAGE };
    }

    // Step 3: Days in state
    const daysInState = computeDaysInState(timeline, input.currentState);

    // Step 4: Progression path
    const { path: progressionPath, segments } = computeProgressionPath(timeline, input.currentState);

    // Step 5: Textbook progression
    const textbookProgression = detectTextbookProgression(segments);

    // Step 6: Prior failed attempt
    const { priorFailedAttempt, priorAttemptDaysAgo } = detectPriorFailedAttempt(timeline, today);

    // Step 7: Regime consistency
    const regimeShift = detectRegimeShift(timeline, input.currentMood);

    // Step 8: Composite adjustment
    const adjustment = computeAdjustment(
      textbookProgression,
      daysInState,
      input.currentState,
      priorFailedAttempt,
      priorAttemptDaysAgo,
      regimeShift
    );

    // Step 9: VDU precedence detection (only for CB ACTIVE signals)
    let preceded_by_vdu = false;
    if (input.strategy === 'consolidation_breakout' && input.currentState === 'active') {
      preceded_by_vdu = detectPrecededByVdu(entries, input.ticker);
    }

    return {
      daysInState,
      progressionPath,
      textbookProgression,
      priorFailedAttempt,
      priorAttemptDaysAgo,
      regimeShift,
      adjustment,
      preceded_by_vdu,
    };
  } catch {
    // Graceful degradation: return neutral on any error
    return { ...NEUTRAL_LINEAGE };
  }
}
