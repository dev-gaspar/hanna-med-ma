/**
 * Shared patient flag helpers — mirrors the backend isNew computation
 * (see server/src/core/date.util.ts#isWithinLast24Hours) so the chat
 * and the static list surface the same "new" badge.
 */

/**
 * True when the patient's `admittedDate` (CMS gives us "MM/DD") falls
 * today or yesterday. Uses the browser's local timezone — close enough
 * to the server's America/New_York for the "new" label since both are
 * aligned on day boundaries from the doctor's perspective.
 */
export function isAdmittedRecently(admittedDate?: string | null): boolean {
	if (!admittedDate) return false;
	const [mm, dd] = admittedDate.split("/").map(Number);
	if (!mm || !dd) return false;
	const now = new Date();
	const admitted = new Date(now.getFullYear(), mm - 1, dd);

	const startYesterday = new Date(now);
	startYesterday.setDate(now.getDate() - 1);
	startYesterday.setHours(0, 0, 0, 0);

	const endTomorrow = new Date(now);
	endTomorrow.setDate(now.getDate() + 1);
	endTomorrow.setHours(23, 59, 59, 999);

	return admitted > startYesterday && admitted < endTomorrow;
}
