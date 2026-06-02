// ============================================================
// Badge Helpers — Tiered badge labels for confidence & confluence
// ============================================================
// Pure functions mapping numeric scores to human-readable badge
// strings. Consumed by Slack and Discord notifiers for consistent
// badge rendering across platforms.
// ============================================================

/**
 * Map a confidence score to a tiered badge label.
 * @param confidence - numeric value, expected in [0, 1]
 * @returns badge string or "" if below threshold / invalid
 */
export function confidenceBadge(confidence: number | null | undefined): string {
  if (confidence == null || !isFinite(confidence) || confidence < 0 || confidence > 1) {
    return '';
  }
  if (confidence >= 0.80) return '🔥 High';
  if (confidence >= 0.65) return '★ Good';
  if (confidence >= 0.50) return '~ Fair';
  return '';
}

/**
 * Map a confluence score to a tiered badge label.
 * @param confluence - numeric value, expected in [0.0, 1.0]
 * @returns badge string or "" if below threshold / invalid
 */
export function confluenceBadge(confluence: number | null | undefined): string {
  if (confluence == null || !isFinite(confluence) || confluence < 0 || confluence > 1) {
    return '';
  }
  if (confluence > 0.7) return '⚑ Multi-strategy';
  if (confluence >= 0.5) return '⚑ Confirmed';
  return '';
}

/**
 * Map a fundamental tier to a badge label.
 * @param tier - fundamental tier string: "strong", "mixed", or "weak"
 * @returns badge string or "" if tier is unrecognized/null/undefined
 */
export function fundamentalBadge(tier: string | null | undefined): string {
  if (tier === 'strong') return 'F 🟢';
  if (tier === 'mixed') return 'F 🟡';
  if (tier === 'weak') return 'F 🔴';
  return '';
}
