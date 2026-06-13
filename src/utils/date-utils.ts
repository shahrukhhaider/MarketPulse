// ============================================================
// Date Utilities — All dates normalized to Pacific Time (PST/PDT)
// ============================================================
// This module ensures consistent date handling regardless of the
// server's system timezone. All "today" computations and date
// formatting use America/Los_Angeles explicitly.
// ============================================================

const TZ = 'America/Los_Angeles';

/**
 * Returns today's date as a YYYY-MM-DD string in Pacific time.
 * Safe to use on any server regardless of system timezone.
 */
export function todayPST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/**
 * Formats a Date object as a YYYY-MM-DD string in Pacific time.
 */
export function formatDatePST(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}

/**
 * The canonical timezone identifier used across the project.
 */
export const PROJECT_TIMEZONE = TZ;
