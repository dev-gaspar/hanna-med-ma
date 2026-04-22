import api from "../lib/api";
import type {
	CodingStatus,
	EncounterCoding,
	InboxResponse,
} from "../types/coding";

/**
 * Client for the AI Coder endpoints. Kept tiny — the rendering side
 * (CodingPanel) carries the UX state machine; this file is the HTTP
 * shape only.
 */
export const codingService = {
	/**
	 * Doctor's coding inbox — every encounter with a signed note
	 * joined with its latest coding pass (or null). Server already
	 * sorts the rows; filters are applied server-side.
	 */
	async getInbox(filters: {
		status?: string;
		riskBand?: string;
		emrSystem?: string;
		search?: string;
	} = {}): Promise<InboxResponse> {
		const params = new URLSearchParams();
		if (filters.status) params.set("status", filters.status);
		if (filters.riskBand) params.set("riskBand", filters.riskBand);
		if (filters.emrSystem) params.set("emrSystem", filters.emrSystem);
		if (filters.search) params.set("search", filters.search);
		const qs = params.toString();
		const res = await api.get<InboxResponse>(
			`/coding/inbox${qs ? `?${qs}` : ""}`,
		);
		return res.data;
	},

	/** Latest proposal for an encounter, or null if none has been run yet. */
	async getLatest(encounterId: number): Promise<EncounterCoding | null> {
		const res = await api.get<EncounterCoding | null>(
			`/coding/encounters/${encounterId}`,
		);
		return res.data;
	},

	/**
	 * Enqueue an AI Coder run against this encounter's signed note. Returns
	 * 202 immediately with the new coding id — the agent runs in the
	 * background on the server. The caller is expected to poll `getLatest`
	 * (or use `useCodingPolling`) until the row reaches a terminal status.
	 */
	async generate(
		encounterId: number,
	): Promise<{ coding: { id: number; status: CodingStatus } }> {
		const res = await api.post<{
			coding: { id: number; status: CodingStatus };
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
