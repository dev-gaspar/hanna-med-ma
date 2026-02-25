const DEFAULT_TIMEZONE = "America/New_York";

const FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

/**
 * Formats a Date for user-facing display using a globally configurable timezone.
 * Set APP_TIMEZONE env var to override (e.g. "America/Chicago", "America/Los_Angeles").
 * Default: America/New_York
 */
export function formatDateForDisplay(date: Date): string {
  const tz = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
  return date.toLocaleString("en-US", { ...FORMAT_OPTIONS, timeZone: tz });
}
