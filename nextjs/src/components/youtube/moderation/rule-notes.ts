/**
 * Threshold input checks for the rules editor, kept pure (no imports) so
 * `scripts/unit/moderation-rule-notes.mjs` can run them under strip-types.
 *
 * Spec boundary rows: a match is `probability >= threshold`; a threshold of 0
 * matches every comment and the dashboard must warn; a threshold of 1 matches
 * only a probability of exactly 1.
 */

/** The threshold as a number, or null when it is not a number in [0, 1]. */
export function parseThreshold(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

export interface ThresholdNote {
  tone: 'error' | 'warning' | 'info';
  text: string;
}

/** What the editor shows under a threshold input, or null for an ordinary value. */
export function thresholdNote(raw: string): ThresholdNote | null {
  const n = parseThreshold(raw);
  if (n === null) return { tone: 'error', text: 'Enter a number from 0 to 1.' };
  if (n === 0) {
    return {
      tone: 'warning',
      text: 'A threshold of 0 matches every comment, so this action applies to all of them.',
    };
  }
  if (n === 1) {
    return {
      tone: 'info',
      text: 'A threshold of 1 matches only a probability of exactly 1.0 (100%), which is rare.',
    };
  }
  return null;
}
