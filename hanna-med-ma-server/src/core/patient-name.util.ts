/**
 * Normalize a patient name for consistent storage and matching.
 * "GARCIA, JOSE" → "garcia jose"
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim();
}
