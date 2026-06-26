/**
 * Centralized date/number formatting for the dashboard.
 *
 * All display formatting goes through these helpers so the UI stays consistent
 * (and so we never sprinkle raw `toLocale*` calls across components again).
 * Locale is pinned to `en-US` to keep output stable regardless of the viewer's
 * browser locale.
 */

export type DateInput = string | number | Date;

const LOCALE = "en-US";

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

const LONG_DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

const DATE_TIME: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "Jun 26, 2026" — the default compact date style. */
export function formatDate(value: DateInput): string {
  return toDate(value).toLocaleDateString(LOCALE, SHORT_DATE);
}

/** "June 26, 2026" — spelled-out month, for billing/settings emphasis. */
export function formatDateLong(value: DateInput): string {
  return toDate(value).toLocaleDateString(LOCALE, LONG_DATE);
}

/** "Jun 26, 2026, 3:45 PM" — date with time of day. */
export function formatDateTime(value: DateInput): string {
  return toDate(value).toLocaleString(LOCALE, DATE_TIME);
}

/** "Jun 26, 2026 – Jul 26, 2026" — an inclusive date range. */
export function formatDateRange(start: DateInput, end: DateInput): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** "1,234" — thousands-separated integer/number. */
export function formatNumber(value: number): string {
  return value.toLocaleString(LOCALE);
}
