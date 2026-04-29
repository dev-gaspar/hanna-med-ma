import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
	ArrowLeft,
	CheckCircle2,
	FileText,
	FlaskConical,
	Loader2,
	Shield,
	X,
	Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { patientService } from "../../services/patientService";
import { useDoctorData } from "../../contexts/DoctorDataContext";
import { getHospital } from "../../lib/hospitals";
import type { Patient } from "../../types";
import { cls } from "../../lib/cls";
import { isAdmittedRecently } from "../../lib/patientFlags";
import { Chip } from "../../components/ui/Chip";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { PlaceOfServiceField } from "../../components/ui/PlaceOfServiceField";

type Filter = "all" | "unseen" | "seen";

const UNGROUPED = "__ungrouped__";

export default function PatientListPage() {
	const { system } = useParams<{ system: string }>();
	const navigate = useNavigate();
	const hospital = getHospital(system);
	const emrKey = hospital?.key;

	const {
		patientsBySystem,
		seenIds,
		loading,
		markSeenLocally,
		posCatalog,
		specialtyPosConfig,
	} = useDoctorData();
	const patients = emrKey ? patientsBySystem[emrKey] || [] : [];

	const [filter, setFilter] = useState<Filter>("all");

	const [markingId, setMarkingId] = useState<number | null>(null);
	const [modalPatient, setModalPatient] = useState<Patient | null>(null);
	const [encounterType, setEncounterType] = useState<
		"CONSULT" | "PROGRESS" | "PROCEDURE"
	>("CONSULT");
	const todayIso = () => new Date().toISOString().slice(0, 10);
	const [encounterDate, setEncounterDate] = useState<string>(todayIso());
	// CMS Place of Service code, captured at sign-off (Dr. Peter,
	// 2026-04-18). Pre-fill comes from the doctor's specialty
	// config (Specialty.defaultPosCode); no EMR-based fallback.
	const [encounterPos, setEncounterPos] = useState<string>("");

	const filtered = useMemo(() => {
		if (filter === "all") return patients;
		if (filter === "seen") return patients.filter((p) => seenIds.has(p.id));
		return patients.filter((p) => !seenIds.has(p.id));
	}, [patients, seenIds, filter]);

	/**
	 * Group patients by facility. Any EMR whose patients carry a `facility`
	 * gets sub-hospital headers. Patients without a facility fall into a
	 * single UNGROUPED bucket that renders flat, no header.
	 */
	const grouped = useMemo(() => {
		const map = new Map<string, Patient[]>();
		for (const p of filtered) {
			const key = p.facility?.trim() || UNGROUPED;
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(p);
		}
		// Sort: named facilities alphabetically, UNGROUPED last.
		return Array.from(map.entries()).sort(([a], [b]) => {
			if (a === UNGROUPED) return 1;
			if (b === UNGROUPED) return -1;
			return a.localeCompare(b);
		});
	}, [filtered]);

	const sendToChat = (query: string) => {
		navigate(`/doctor/chat?q=${encodeURIComponent(query)}`);
	};

	const handleAction = (
		action: "summary" | "insurance" | "lab",
		patient: Patient,
	) => {
		const prefix =
			action === "summary"
				? "Check clinical summary of"
				: action === "insurance"
					? "Check medical insurance of"
					: "Check lab results of";
		sendToChat(`${prefix} ${patient.name}`);
	};

	const openMarkSeen = (patient: Patient) => {
		setModalPatient(patient);
		setEncounterType("CONSULT");
		setEncounterDate(todayIso());
		// Pre-fill POS from the doctor's specialty default. If unset
		// the field starts empty and the doctor must pick before
		// confirming. `patient` arg kept for future extensibility
		// (e.g. per-patient override) even though we don't use it.
		void patient;
		setEncounterPos(specialtyPosConfig?.defaultPosCode ?? "");
	};

	const handleConfirmEncounter = async () => {
		if (!modalPatient) return;
		if (!encounterPos) {
			toast.error(
				"Pick a place of service before confirming the encounter.",
			);
			return;
		}
		const patient = modalPatient;
		setMarkingId(patient.id);
		setModalPatient(null);
		const label =
			encounterType === "CONSULT"
				? "Consult"
				: encounterType === "PROGRESS"
					? "Follow-Up"
					: "Procedure";
		try {
			await patientService.markAsSeen(
				patient.id,
				encounterType,
				encounterDate,
				encounterPos,
			);
			const isToday = encounterDate === todayIso();
			toast.success(
				isToday
					? `${label} encounter created`
					: `${label} encounter created for ${encounterDate}`,
			);
			// Update the shared cache so every consumer (Round, PatientList, …)
			// reflects the change without a network round-trip.
			markSeenLocally(patient.id);
		} catch (e) {
			console.error("mark seen failed", e);
			toast.error("Failed to create encounter. Please try again.");
		} finally {
			setMarkingId(null);
		}
	};

	if (!hospital) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center p-6">
				<h2 className="font-serif text-[18px] text-n-900 mb-1">
					Hospital not found
				</h2>
				<p className="text-[12.5px] text-n-500 mb-4">
					"{system}" is not a recognized EMR system.
				</p>
				<Link to="/doctor/round">
					<Button
						tone="ghost"
						size="sm"
						leading={<ArrowLeft className="w-3.5 h-3.5" />}
					>
						Back to round
					</Button>
				</Link>
			</div>
		);
	}

	const counts = {
		all: patients.length,
		unseen: patients.filter((p) => !seenIds.has(p.id)).length,
		seen: patients.filter((p) => seenIds.has(p.id)).length,
	};

	// Whether this hospital has any sub-facilities at all — controls group headers.
	const hasFacilities = grouped.some(([key]) => key !== UNGROUPED);

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<div className="bg-n-0 border-b border-n-150 shrink-0">
				<div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
					<Link
						to="/doctor/round"
						className="inline-flex items-center justify-center w-8 h-8 rounded-md text-n-600 hover:text-n-900 hover:bg-n-100 transition"
						aria-label="Back"
					>
						<ArrowLeft className="w-4 h-4" />
					</Link>
					<div className="flex-1 min-w-0">
						<div className="font-serif text-[16px] font-medium text-n-900 leading-none truncate flex items-center gap-2">
							<span
								className="w-1.5 h-1.5 rounded-full shrink-0"
								style={{ background: hospital.hue }}
							/>
							{hospital.label}
						</div>
						<div className="font-mono text-[10px] uppercase tracking-wider text-n-500 mt-1 truncate">
							{counts.all} total · {counts.unseen} unseen
						</div>
					</div>
				</div>
				{/* Filter strip */}
				<div className="max-w-5xl mx-auto px-4 pb-2.5 pt-1 flex gap-1.5 overflow-x-auto">
					{([
						{ id: "all", label: "All", n: counts.all },
						{ id: "unseen", label: "Unseen", n: counts.unseen },
						{ id: "seen", label: "Seen", n: counts.seen },
					] as { id: Filter; label: string; n: number }[]).map((f) => (
						<button
							key={f.id}
							onClick={() => setFilter(f.id)}
							className={cls(
								"h-7 px-2.5 rounded-full text-[12px] font-medium whitespace-nowrap inline-flex items-center gap-1.5 transition",
								filter === f.id
									? "bg-n-900 text-n-0"
									: "bg-n-100 text-n-700 hover:bg-n-150",
							)}
						>
							{f.label}
							<span
								className={cls(
									"font-mono text-[10px] tabular-nums",
									filter === f.id ? "text-n-0/60" : "text-n-500",
								)}
							>
								{f.n}
							</span>
						</button>
					))}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto custom-scrollbar">
				{loading && patients.length === 0 ? (
					<div className="flex items-center justify-center gap-2 py-16 text-n-500">
						<Loader2 className="w-4 h-4 animate-spin" />
						<span className="font-mono text-[11px] uppercase tracking-widest">
							Loading census
						</span>
					</div>
				) : filtered.length === 0 ? (
					<div className="max-w-5xl mx-auto px-4 py-12 text-center">
						<p className="font-mono text-[11.5px] uppercase tracking-widest text-n-500">
							{filter === "unseen"
								? "No unseen patients — nice"
								: filter === "seen"
									? "No patients marked seen yet"
									: "No patients in this hospital"}
						</p>
					</div>
				) : (
					<div className="max-w-5xl mx-auto px-4 py-3 space-y-5">
						{grouped.map(([key, group]) => (
							<div key={key} className="space-y-2">
								{hasFacilities && key !== UNGROUPED && (
									<div className="flex items-center gap-2 pl-0.5">
										<span className="label-kicker">Facility</span>
										<span className="text-n-300">·</span>
										<span className="font-serif text-[14px] text-n-900">
											{key}
										</span>
										<span className="font-mono text-[10.5px] text-n-500 tabular-nums">
											{group.length}
										</span>
									</div>
								)}
								<ul className="space-y-2">
									{group.map((p) => (
										<PatientRow
											key={p.id}
											patient={p}
											isSeen={seenIds.has(p.id)}
											onAction={(a) => handleAction(a, p)}
											onMarkSeen={() => openMarkSeen(p)}
											isMarking={markingId === p.id}
										/>
									))}
								</ul>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Mark-seen modal */}
			{modalPatient && (
				<div
					className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-n-900/40 backdrop-blur-[2px]"
					onClick={() => setModalPatient(null)}
				>
					<div
						className="bg-n-0 rounded-t-2xl sm:rounded-lg border-t sm:border border-n-200 shadow-deep w-full sm:max-w-[540px] px-5 pt-4 pb-6 sm:p-6"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="w-10 h-1 bg-n-200 rounded-full mx-auto mb-4 sm:hidden" />
						<div className="flex items-start justify-between mb-4">
							<div className="min-w-0">
								<h3 className="font-serif text-[18px] text-n-900 leading-tight truncate">
									Mark {modalPatient.name} as seen
								</h3>
								<p className="text-[12px] text-n-500 mt-1">
									Creates an encounter record. Sign-off is deliberate.
								</p>
							</div>
							<IconButton
								onClick={() => setModalPatient(null)}
								aria-label="Close"
								className="shrink-0"
							>
								<X className="w-4 h-4" />
							</IconButton>
						</div>

						<div className="space-y-4">
							<div>
								<label className="label-kicker block mb-1.5">
									Encounter type
								</label>
								<div className="grid grid-cols-3 gap-2">
									{(
										[
											{
												value: "CONSULT",
												label: "Consult",
												caption: "1st visit",
											},
											{
												value: "PROGRESS",
												label: "Follow-Up",
												caption: "daily",
											},
											{
												value: "PROCEDURE",
												label: "Procedure",
												caption: "surgical",
											},
										] as const
									).map((opt) => {
										const selected = encounterType === opt.value;
										return (
											<button
												key={opt.value}
												type="button"
												onClick={() => setEncounterType(opt.value)}
												className={cls(
													"h-12 rounded-md border text-[13px] font-medium transition flex flex-col items-center justify-center leading-none px-2",
													selected
														? "border-p-500 bg-p-50 text-p-700"
														: "border-n-200 text-n-700 hover:bg-n-100",
												)}
											>
												<span className="truncate max-w-full">
													{opt.label}
												</span>
												<span className="font-mono text-[10px] opacity-70 mt-1 truncate max-w-full">
													{opt.caption}
												</span>
											</button>
										);
									})}
								</div>
								<p className="mt-1.5 text-[10.5px] text-n-500 leading-tight">
									Procedure visits skip the E/M code — the operative CPT
									(amputation, debridement, fixation…) is the primary.
								</p>
							</div>

							<div>
								<label
									htmlFor="dos"
									className="label-kicker block mb-1.5"
								>
									Date of service
								</label>
								<div className="relative">
									<Calendar className="w-3.5 h-3.5 text-n-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
									<input
										id="dos"
										type="date"
										value={encounterDate}
										max={todayIso()}
										onChange={(e) => setEncounterDate(e.target.value)}
										className="input-field h-10 pl-8"
									/>
								</div>
								<p className="mt-1 text-[10.5px] text-n-500 leading-tight">
									Defaults to today. Change it if you forgot to mark the visit
									on the actual day.
								</p>
							</div>

							<PlaceOfServiceField
								value={encounterPos}
								onChange={setEncounterPos}
								catalog={posCatalog}
								quickPickCodes={specialtyPosConfig?.commonPosCodes ?? []}
							/>
						</div>

						<div className="flex gap-2 mt-5">
							<Button
								tone="ghost"
								size="md"
								onClick={() => setModalPatient(null)}
								className="flex-1"
							>
								Cancel
							</Button>
							<Button
								tone="primary"
								size="md"
								onClick={handleConfirmEncounter}
								className="flex-1"
							>
								Sign & record
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/** One row in the per-hospital patient list. */
function PatientRow({
	patient,
	isSeen,
	onAction,
	onMarkSeen,
	isMarking,
}: {
	patient: Patient;
	isSeen: boolean;
	onAction: (action: "summary" | "insurance" | "lab") => void;
	onMarkSeen: () => void;
	isMarking: boolean;
}) {
	const actionBtn =
		"inline-flex items-center gap-1.5 h-7 px-2 rounded border border-n-200 bg-n-0 text-n-700 text-[11.5px] hover:bg-n-100 transition";

	const isNew = isAdmittedRecently(patient.admittedDate);

	return (
		<li className="bg-n-0 rounded-lg border border-n-150 px-3.5 py-3">
			<div className="flex items-start gap-2.5">
				{/* Accent rail mirrors PatientCard: warn-colored for newly admitted */}
				<div
					className={cls(
						"w-1 self-stretch rounded-full mt-0.5",
						isNew ? "bg-[var(--warn-fg)]" : "bg-transparent",
					)}
				/>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<Link
							to={`/doctor/patient/${patient.id}`}
							className="font-semibold text-[13.5px] text-n-900 truncate hover:text-p-700 transition"
						>
							{patient.name}
						</Link>
						{isNew && <Chip tone="warn">new</Chip>}
						{isSeen && <Chip tone="ok">seen</Chip>}
					</div>
					<div className="mt-1 space-y-0.5">
						{patient.reason && (
							<div className="flex items-baseline gap-2 text-[11.5px] leading-snug">
								<span className="label-kicker w-[64px] shrink-0">Reason</span>
								<span className="font-mono text-n-700 truncate">
									{patient.reason}
								</span>
							</div>
						)}
						{patient.location && (
							<div className="flex items-baseline gap-2 text-[11.5px] leading-snug">
								<span className="label-kicker w-[64px] shrink-0">
									Location
								</span>
								<span className="font-mono text-n-700 truncate">
									{patient.location}
								</span>
							</div>
						)}
						{patient.admittedDate && (
							<div className="flex items-baseline gap-2 text-[11.5px] leading-snug">
								<span className="label-kicker w-[64px] shrink-0">Admit</span>
								<span className="font-mono text-n-700 truncate">
									{patient.admittedDate}
								</span>
							</div>
						)}
					</div>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-1.5 mt-3">
				<button onClick={() => onAction("summary")} className={actionBtn}>
					<FileText className="w-3.5 h-3.5" />
					<span>Summary</span>
				</button>
				<button onClick={() => onAction("insurance")} className={actionBtn}>
					<Shield className="w-3.5 h-3.5" />
					<span>Insurance</span>
				</button>
				<button onClick={() => onAction("lab")} className={actionBtn}>
					<FlaskConical className="w-3.5 h-3.5" />
					<span>Lab</span>
				</button>
				{!isSeen && (
					<button
						onClick={onMarkSeen}
						disabled={isMarking}
						className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-p-600 text-white text-[11.5px] hover:bg-p-700 disabled:opacity-40 transition"
					>
						{isMarking ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<CheckCircle2 className="w-3.5 h-3.5" />
						)}
						<span>Mark seen</span>
					</button>
				)}
			</div>
		</li>
	);
}
