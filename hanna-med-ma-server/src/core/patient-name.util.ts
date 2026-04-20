import type { Patient } from "@prisma/client";

/**
 * Normalize a patient name for consistent storage and matching.
 * "GARCIA, JOSE" → "garcia jose"
 */
export function normalizeName(name: string): string {
	return name
		.toLowerCase()
		.replace(/,/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Tokenize a normalized name into searchable words (≥ 2 chars).
 * "garcia jose a" → ["garcia", "jose"]   (single-letter middle initials are dropped)
 */
export function tokenizeName(name: string): string[] {
	return normalizeName(name)
		.split(" ")
		.filter((t) => t.length >= 2);
}

/**
 * Rank a candidate patient against a query.
 *
 *   3 = exact match on normalized name ("perez maria a" === "perez maria a")
 *   2 = query is a prefix of candidate, or candidate is a prefix of query
 *   1 = every query token appears as a whole word in candidate
 *   0 = otherwise
 *
 * Case-insensitive, comma-insensitive, whitespace-normalized.
 */
export function scorePatientMatch(
	candidate: { normalizedName: string },
	query: string,
): number {
	const q = normalizeName(query);
	const c = candidate.normalizedName; // already normalized at insert time
	if (!q || !c) return 0;

	if (c === q) return 3;
	if (c.startsWith(q) || q.startsWith(c)) return 2;

	const qTokens = tokenizeName(q);
	if (qTokens.length === 0) return 0;

	const cWords = new Set(c.split(" "));
	const allPresent = qTokens.every((t) => cWords.has(t));
	return allPresent ? 1 : 0;
}

/**
 * Given a list of patients and the raw query string, return the best matches.
 *
 * Rules:
 *   - If any candidate is an EXACT match, return only those (ignore weaker matches).
 *   - Else if any candidate is a PREFIX match, return only those.
 *   - Else return all whole-word matches.
 *   - Never return score 0 matches (avoids "perez" inside "fuentesperez").
 */
export function rankAndFilterPatients<T extends Pick<Patient, "normalizedName">>(
	candidates: T[],
	query: string,
): T[] {
	const scored = candidates
		.map((p) => ({ p, score: scorePatientMatch(p, query) }))
		.filter((x) => x.score > 0);

	if (scored.length === 0) return [];

	const maxScore = Math.max(...scored.map((x) => x.score));
	return scored.filter((x) => x.score === maxScore).map((x) => x.p);
}
