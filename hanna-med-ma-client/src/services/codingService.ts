import api from "../lib/api";
import type { CoderProposal, EncounterCoding } from "../types/coding";

/**
 * Client for the AI Coder endpoints. Kept tiny — the rendering side
 * (CodingPanel) carries the UX state machine; this file is the HTTP
 * shape only.
 */
export const codingService = {
	/** Latest proposal for an encounter, or null if none has been run yet. */
	async getLatest(encounterId: number): Promise<EncounterCoding | null> {
		const res = await api.get<EncounterCoding | null>(
			`/coding/encounters/${encounterId}`,
		);
		return res.data;
	},

	/**
	 * Run the AI Coder against this encounter's signed note. Each call
	 * creates a new DRAFT — the server is intentionally stateless here,
	 * the UI decides whether to display history or replace in place.
	 */
	async generate(
		encounterId: number,
	): Promise<{ coding: { id: number }; proposal: CoderProposal | null }> {
		const res = await api.post<{
			coding: { id: number };
			proposal: CoderProposal | null;
		}>(`/coding/encounters/${encounterId}/generate`);
		return res.data;
	},

	/** Approve / sign-off a proposal. Records the current doctor's ID server-side. */
	async approve(codingId: number): Promise<EncounterCoding> {
		const res = await api.patch<EncounterCoding>(
			`/coding/proposals/${codingId}/approve`,
		);
		return res.data;
	},

	/** Mark APPROVED as transferred to CareTracker (Hajira's manual step). */
	async markTransferred(codingId: number): Promise<EncounterCoding> {
		const res = await api.patch<EncounterCoding>(
			`/coding/proposals/${codingId}/transferred`,
		);
		return res.data;
	},
};
