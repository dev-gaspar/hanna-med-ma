import { useEffect, useRef, useState } from "react";
import { codingService } from "../services/codingService";
import {
	type CodingStatus,
	type EncounterCoding,
	TERMINAL_CODING_STATUSES,
} from "../types/coding";

interface Options {
	/** Poll interval in ms. Default 3000 — matches the server's DB flush cadence. */
	intervalMs?: number;
	/** Stop polling entirely (e.g., panel closed). */
	enabled?: boolean;
	/**
	 * Bump this when a new run has been enqueued so the hook re-fetches
	 * immediately and resumes polling (the previous terminal state is
	 * no longer current). Any value change triggers a re-fetch.
	 */
	refetchKey?: number | string;
}

interface PollingState {
	coding: EncounterCoding | null;
	status: CodingStatus | null;
	isPolling: boolean;
	error: string | null;
}

const isTerminal = (s: CodingStatus | null | undefined): boolean =>
	s != null && TERMINAL_CODING_STATUSES.includes(s);

/**
 * Polls `GET /coding/encounters/:id` until the row reaches a terminal
 * status. Returns the live coding row (including reasoningLog) so the
 * UI can render both the in-flight timeline and the final proposal.
 *
 * The hook also accepts null for the encounterId — lets callers mount
 * it unconditionally and flip it on when they know which encounter.
 */
export function useCodingPolling(
	encounterId: number | null,
	options: Options = {},
): PollingState {
	const { intervalMs = 3000, enabled = true, refetchKey } = options;
	const [coding, setCoding] = useState<EncounterCoding | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isPolling, setIsPolling] = useState(false);
	// Track whether the current effect run is still the active one —
	// protects against a stale fetch resolving after the user navigated
	// to a different encounter.
	const activeRef = useRef(false);

	useEffect(() => {
		if (!enabled || encounterId == null) {
			return;
		}

		activeRef.current = true;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const fetchOnce = async () => {
			if (!activeRef.current) return;
			try {
				const row = await codingService.getLatest(encounterId);
				if (!activeRef.current) return;
				setCoding(row);
				setError(null);
				// Keep polling only while the latest row is IN_PROGRESS.
				// If the row is null (no coding yet) we also stop — the
				// panel will show the "Generate" CTA and re-enable the
				// hook when the user kicks off a run.
				if (row && !isTerminal(row.status)) {
					setIsPolling(true);
					timer = setTimeout(fetchOnce, intervalMs);
				} else {
					setIsPolling(false);
				}
			} catch (e) {
				if (!activeRef.current) return;
				setError((e as Error).message || "Failed to load coding");
				setIsPolling(false);
			}
		};

		void fetchOnce();

		return () => {
			activeRef.current = false;
			if (timer) clearTimeout(timer);
		};
	}, [encounterId, enabled, intervalMs, refetchKey]);

	return {
		coding,
		status: coding?.status ?? null,
		isPolling,
		error,
	};
}
