/**
 * Centralized date utility — single source of truth for all date operations.
 *
 * Uses dayjs with UTC plugin. All dates are created and stored in UTC.
 * Conversion to display timezone only happens in `formatForDisplay()`.
 */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

/** Application display timezone — all user-facing dates are shown in this zone */
const DISPLAY_TIMEZONE = "America/New_York";

/**
 * Get the current time in UTC as a JS Date.
 */
export function nowDate(): Date {
  return dayjs.utc().toDate();
}

/**
 * Get the current time as ISO string (UTC).
 */
export function nowISO(): string {
  return dayjs.utc().toISOString();
}

/**
 * Create a deadline N hours from now (UTC).
 */
export function deadlineFromNow(hours: number): Date {
  return dayjs.utc().add(hours, "hour").toDate();
}

/**
 * Parse a date (string, Date, or number) and return as JS Date (UTC).
 */
export function parseToDate(input: string | Date | number): Date {
  return dayjs.utc(input).toDate();
}

/**
 * Format a date for user-facing display in the application timezone.
 * Example output: "Jan 1, 2026, 1:05 PM"
 */
export function formatForDisplay(date: Date): string {
  return dayjs.utc(date).tz(DISPLAY_TIMEZONE).format("MMM D, YYYY, h:mm A");
}

/**
 * Get the current time formatted for display (used by AI prompts).
 * Example output: "1:05:30 PM"
 */
export function currentTimeForDisplay(): string {
  return dayjs.utc().tz(DISPLAY_TIMEZONE).format("h:mm:ss A");
}

/**
 * Get the current date formatted for display.
 * Example output: "March 31, 2026"
 */
export function currentDateForDisplay(): string {
  return dayjs.utc().tz(DISPLAY_TIMEZONE).format("MMMM D, YYYY");
}

/**
 * Check if an admitted date string (MM/DD format) is within the last 24 hours.
 * Comparison is done in the display timezone to match the user's perspective.
 */
export function isWithinLast24Hours(admittedDate: string): boolean {
  const [mm, dd] = admittedDate.split("/").map(Number);
  if (!mm || !dd) return false;

  const nowInTz = dayjs.utc().tz(DISPLAY_TIMEZONE);
  const year = nowInTz.year();
  const admitted = dayjs.tz(
    `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
    DISPLAY_TIMEZONE,
  );
  const yesterday = nowInTz.subtract(1, "day").startOf("day");

  return (
    admitted.isAfter(yesterday) && admitted.isBefore(nowInTz.add(1, "day"))
  );
}

/** The display timezone constant for reference */
export const TIMEZONE = DISPLAY_TIMEZONE;
