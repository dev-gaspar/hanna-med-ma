import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { doctorAuthService } from "../services/doctorAuthService";
import { patientService } from "../services/patientService";
import {
	placeOfServiceService,
	type PlaceOfServiceCode,
} from "../services/placeOfServiceService";
import { specialtyService } from "../services/specialtyService";
import type { EmrSystem, Patient } from "../types";

export interface SpecialtyPosConfig {
	commonPosCodes: string[];
	defaultPosCode: string | null;
}

/**
 * Shared, in-memory cache for everything the doctor portal reads.
 *
 * Motivation:
 *   Before this context each screen (Round, PatientList, Me) fetched the
 *   same data independently — navigating between tabs fired duplicate
 *   network requests and re-rendered from scratch. Now DoctorLayout mounts
 *   this provider, the data loads once, and every descendant reads from
 *   the same cache. Mutations (mark-as-seen) update the cache in place so
 *   the UI reacts instantly without a refetch.
 *
 * Freshness policy:
 *   - First mount: load everything (patients for each EMR system the
 *     doctor has access to, plus the list of seen IDs).
 *   - Stale-after-refresh(): caller can force a background refetch
 *     (e.g. pull-to-refresh).
 *   - Cache lives as long as the DoctorLayout is mounted. Logout tears
 *     down the provider, which clears state.
 */

interface DoctorDataState {
	loading: boolean;
	patientsBySystem: Record<string, Patient[]>;
	seenIds: Set<number>;
	/** All ACTIVE Place-of-Service rows from the catalog. Drives the
	 *  full "Other…" select in the encounter modal. */
	posCatalog: PlaceOfServiceCode[];
	/** This doctor's specialty POS config: which codes to render as
	 *  quick-picks and which to pre-select. Null while loading or
	 *  if the doctor isn't linked to a specialty. */
	specialtyPosConfig: SpecialtyPosConfig | null;
	/** Forces a fresh fetch of everything. */
	refresh: () => Promise<void>;
	/**
	 * Mark a patient ID as seen locally — avoids a network round-trip to
	 * reflect the change in the UI after a successful markAsSeen call.
	 */
	markSeenLocally: (patientId: number) => void;
}

const DoctorDataContext = createContext<DoctorDataState | null>(null);

export function DoctorDataProvider({ children }: { children: ReactNode }) {
	// Read doctor once (see TodaysRound for the lazy-init rationale).
	const [doctor] = useState(() => doctorAuthService.getCurrentDoctor());
	const emrSystems = ((doctor?.emrSystems as EmrSystem[]) || []).filter(Boolean);

	const [loading, setLoading] = useState(true);
	const [patientsBySystem, setPatientsBySystem] = useState<
		Record<string, Patient[]>
	>({});
	const [seenIds, setSeenIds] = useState<Set<number>>(new Set());
	const [posCatalog, setPosCatalog] = useState<PlaceOfServiceCode[]>([]);
	const [specialtyPosConfig, setSpecialtyPosConfig] =
		useState<SpecialtyPosConfig | null>(null);

	// Serialise system list so we can use it as a stable dep without
	// caring about array identity.
	const systemsKey = emrSystems.slice().sort().join(",");
	const specialtyId = doctor?.specialtyId ?? null;

	const fetchAll = useCallback(async () => {
		setLoading(true);
		try {
			const [seen, posCodes, specialty, ...perSystem] = await Promise.all([
				patientService.getSeenPatientIds(),
				placeOfServiceService.getAll().catch(() => [] as PlaceOfServiceCode[]),
				specialtyId
					? specialtyService
							.getById(specialtyId)
							.then((s) => ({
								commonPosCodes: s.commonPosCodes,
								defaultPosCode: s.defaultPosCode,
							}))
							.catch(() => null)
					: Promise.resolve(null),
				...emrSystems.map((s) =>
					patientService.getAll({ emrSystem: s }).catch(() => []),
				),
			]);
			const map: Record<string, Patient[]> = {};
			emrSystems.forEach((s, i) => (map[s] = perSystem[i] as Patient[]));
			setPatientsBySystem(map);
			setSeenIds(new Set(seen));
			setPosCatalog(posCodes);
			setSpecialtyPosConfig(specialty);
		} catch (error) {
			console.error("DoctorDataContext.fetchAll failed", error);
		} finally {
			setLoading(false);
		}
		// emrSystems reference can vary; systemsKey is the actual fingerprint.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [systemsKey, specialtyId]);

	// Initial load. Guarded against StrictMode double-invocation so we
	// don't fire the same request twice on mount in development.
	const didInitRef = useRef(false);
	useEffect(() => {
		if (didInitRef.current) return;
		didInitRef.current = true;
		fetchAll();
	}, [fetchAll]);

	const refresh = useCallback(() => fetchAll(), [fetchAll]);

	const markSeenLocally = useCallback((patientId: number) => {
		setSeenIds((prev) => {
			if (prev.has(patientId)) return prev;
			const next = new Set(prev);
			next.add(patientId);
			return next;
		});
	}, []);

	return (
		<DoctorDataContext.Provider
			value={{
				loading,
				patientsBySystem,
				seenIds,
				posCatalog,
				specialtyPosConfig,
				refresh,
				markSeenLocally,
			}}
		>
			{children}
		</DoctorDataContext.Provider>
	);
}

export function useDoctorData(): DoctorDataState {
	const ctx = useContext(DoctorDataContext);
	if (!ctx) {
		throw new Error(
			"useDoctorData must be used within a <DoctorDataProvider />",
		);
	}
	return ctx;
}
