import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
	ArrowLeft,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	FileText,
	Loader2,
	CheckCircle2,
} from "lucide-react";
import { patientService } from "../../services/patientService";
import { codingService } from "../../services/codingService";
import { getHospital } from "../../lib/hospitals";
import type {
	EncounterDetail,
	NoteStatus,
	PatientDetail as PatientDetailType,
} from "../../types";
import type { EncounterCoding } from "../../types/coding";
import { cls } from "../../lib/cls";
import { Chip } from "../../components/ui/Chip";
import { Button } from "../../components/ui/Button";
import { CodingPanel } from "./CodingPanel";

const NOTE_STATUS_TONE: Record<
	NoteStatus,
	"ok" | "warn" | "dnr" | "info" | "neutral"
> = {
	FOUND_SIGNED: "ok",
	FOUND_UNSIGNED: "warn",
	SEARCHING: "info",
	PENDING: "info",
	NOT_FOUND: "dnr",
};

const NOTE_STATUS_LABEL: Record<NoteStatus, string> = {
	FOUND_SIGNED: "Signed",
	FOUND_UNSIGNED: "Unsigned",
	SEARCHING: "Searching",
	PENDING: "Pending",
	NOT_FOUND: "Not found",
};

export default function PatientDetail() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const patientId = id ? parseInt(id, 10) : null;

	const [patient, setPatient] = useState<PatientDetailType | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [coding, setCoding] = useState<EncounterCoding | null>(null);
	// "Last attempt log" is diagnostic noise most days — start collapsed.
	const [logOpen, setLogOpen] = useState(false);

	useEffect(() => {
		if (!patientId) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const data = await patientService.getById(patientId);
				if (cancelled) return;
				setPatient(data);
				// Preload the latest coding for the signed encounter, if any.
				// No block on failure — the panel falls back to "Run AI Coder".
				const signed = data.encounters.find(
					(e) => e.noteStatus === "FOUND_SIGNED",
				);
				if (signed) {
					try {
						const latest = await codingService.getLatest(signed.id);
						if (!cancelled) setCoding(latest);
					} catch {
						// ignore
					}
				}
			} catch (e: unknown) {
				if (cancelled) return;
				const err = e as { response?: { status?: number } };
				setError(
					err.response?.status === 404
						? "Patient not found on your census."
						: "Could not load patient detail.",
				);
			} finally {
				// Only drop the loading flag if THIS request is still the one
				// we care about. Otherwise a StrictMode-cancelled fetch would
				// briefly expose {loading:false, patient:null} → flash of the
				// "Patient not available" error state before the second fetch
				// resolves. patientId is a stable URL param, so the guarded
				// setState is safe from the infinite-loading bug we hit
				// earlier in TodaysRound.
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [patientId]);

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center gap-2 text-n-500">
				<Loader2 className="w-4 h-4 animate-spin" />
				<span className="font-mono text-[11px] uppercase tracking-widest">
					Loading patient
				</span>
			</div>
		);
	}

	if (error || !patient) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center p-6">
				<h2 className="font-serif text-[18px] text-n-900 mb-1">
					{error || "Patient not available"}
				</h2>
				<Button
					tone="ghost"
					size="sm"
					onClick={() => navigate(-1)}
					leading={<ArrowLeft className="w-3.5 h-3.5" />}
				>
					Go back
				</Button>
			</div>
		);
	}

	const hospital = getHospital(patient.emrSystem);
	const latestEncounter = patient.encounters[0] ?? null;

	return (
		<div className="flex-1 flex flex-col min-h-0">
			{/* Header */}
			<div className="bg-n-0 border-b border-n-150 shrink-0">
				<div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
					<button
						onClick={() => navigate(-1)}
						className="inline-flex items-center justify-center w-8 h-8 rounded-md text-n-600 hover:text-n-900 hover:bg-n-100 transition"
						aria-label="Back"
					>
						<ArrowLeft className="w-4 h-4" />
					</button>
					<div className="flex-1 min-w-0">
						<div className="font-serif text-[16px] font-medium text-n-900 leading-none truncate">
							{patient.name}
						</div>
						<div className="font-mono text-[10px] uppercase tracking-wider text-n-500 mt-1 truncate flex items-center gap-2">
							{hospital && (
								<>
									<span
										className="w-1.5 h-1.5 rounded-full shrink-0"
										style={{ background: hospital.hue }}
									/>
									<span>{hospital.label}</span>
									{patient.facility && (
										<>
											<span className="text-n-300">·</span>
											<span className="truncate">{patient.facility}</span>
										</>
									)}
								</>
							)}
						</div>
					</div>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto custom-scrollbar">
				<div className="max-w-5xl mx-auto px-4 py-4 space-y-5">
				<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_1fr] gap-5 lg:items-start">
					{/* ── Left column: identity + quick actions ── */}
					<div className="space-y-5">
					{/* Demographics card */}
					<section className="bg-n-0 border border-n-150 rounded-lg">
						<div className="px-4 py-3 border-b border-n-150">
							<div className="label-kicker">Patient</div>
						</div>
						<dl className="divide-y divide-n-150 text-[13px]">
							<Row label="Hospital" value={hospital?.label || patient.emrSystem} />
							{patient.facility && (
								<Row label="Facility" value={patient.facility} />
							)}
							{patient.location && (
								<Row label="Location" value={patient.location} />
							)}
							{patient.reason && <Row label="Reason" value={patient.reason} />}
							{patient.admittedDate && (
								<Row label="Admitted" value={patient.admittedDate} />
							)}
							{patient.billingEmrPatientId && (
								<Row
									label="Chart ID"
									value={patient.billingEmrPatientId}
									mono
								/>
							)}
							<Row
								label="Billing EMR"
								value={patient.billingEmrStatus}
								chipTone={
									patient.billingEmrStatus === "REGISTERED" ||
									patient.billingEmrStatus === "ALREADY_EXISTS"
										? "ok"
										: patient.billingEmrStatus === "FAILED"
											? "dnr"
											: "neutral"
								}
							/>
						</dl>
					</section>

					</div>
					{/* ── Right column: encounter + history + raw data ── */}
					<div className="space-y-5 min-w-0">

					{/* Latest encounter */}
					{latestEncounter && (
						<section className="bg-n-0 border border-n-150 rounded-lg">
							<div className="px-4 py-3 border-b border-n-150 flex items-center gap-3">
								<div>
									<div className="label-kicker">Latest encounter</div>
									<div className="font-serif text-[16px] text-n-900 mt-0.5">
										{latestEncounter.type === "CONSULT"
											? "Consult"
											: latestEncounter.type === "PROGRESS"
												? "Follow-up"
												: "Procedure"}{" "}
										<span className="text-n-500 font-sans text-[13px]">
											· enc #{latestEncounter.id}
										</span>
									</div>
								</div>
								<div className="ml-auto">
									<Chip tone={NOTE_STATUS_TONE[latestEncounter.noteStatus]}>
										{NOTE_STATUS_LABEL[latestEncounter.noteStatus]}
									</Chip>
								</div>
							</div>

							<dl className="divide-y divide-n-150 text-[13px]">
								<Row
									label="Date of service"
									value={formatDate(latestEncounter.dateOfService)}
								/>
								<Row
									label="Note attempts"
									value={`${latestEncounter.noteAttempts}`}
									mono
								/>
								{latestEncounter.noteLastAttemptAt && (
									<Row
										label="Last attempt"
										value={formatDate(latestEncounter.noteLastAttemptAt)}
									/>
								)}
							</dl>

							{/* Documents */}
							<div className="px-4 py-3 border-t border-n-150 space-y-2">
								<div className="label-kicker">Documents</div>
								<DocumentLink
									label="Face sheet"
									url={latestEncounter.faceSheetUrl}
									missingText="Not captured yet"
								/>
								<DocumentLink
									label="Provider note"
									url={latestEncounter.providerNoteUrl}
									missingText={
										latestEncounter.noteStatus === "NOT_FOUND"
											? "Not found in EMR"
											: "Pending — RPA will retry"
									}
								/>
							</div>

							{/* Last attempt log — what the RPA agent did on its
							    most recent pass. Diagnostic noise on happy days,
							    so it sits inside the encounter card collapsed
							    by default at the very bottom. */}
							{latestEncounter.noteAgentSummary && (
								<div className="border-t border-n-150">
									<button
										onClick={() => setLogOpen((v) => !v)}
										className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-n-50 transition"
										aria-expanded={logOpen}
									>
										{logOpen ? (
											<ChevronDown className="w-3.5 h-3.5 text-n-500 shrink-0" />
										) : (
											<ChevronRight className="w-3.5 h-3.5 text-n-500 shrink-0" />
										)}
										<div className="label-kicker">Last attempt log</div>
									</button>
									{logOpen && (
										<div className="px-4 pb-3 border-t border-n-150">
											<p className="text-[12px] text-n-700 leading-[1.6] font-mono whitespace-pre-wrap mt-3">
												{latestEncounter.noteAgentSummary}
											</p>
										</div>
									)}
								</div>
							)}
						</section>
					)}

					{/* Encounter history — older encounters rendered compact */}
					{patient.encounters.length > 1 && (
						<section>
							<div className="label-kicker mb-2">Earlier encounters</div>
							<div className="bg-n-0 border border-n-150 rounded-lg divide-y divide-n-150">
								{patient.encounters.slice(1).map((e) => (
									<EncounterRow key={e.id} encounter={e} />
								))}
							</div>
						</section>
					)}

					{patient.encounters.length === 0 && (
						<section className="bg-n-0 border border-dashed border-n-200 rounded-lg p-4">
							<p className="text-[12.5px] text-n-600 leading-relaxed">
								No encounters recorded yet. Once you mark this patient as seen
								from{" "}
								<Link
									to={`/doctor/hospital/${patient.emrSystem.toLowerCase()}`}
									className="text-p-600 hover:underline"
								>
									the census
								</Link>
								, the note search and face-sheet capture will start automatically.
							</p>
						</section>
					)}
					</div>
				</div>

				{/* ── AI Coder panel — full width so the 3-column review
				     (note + bill + defense) has room to breathe. Sits
				     under the 2-column patient grid so the demographics
				     and encounter metadata stay visible as an anchor. ── */}
				{latestEncounter &&
					latestEncounter.noteStatus === "FOUND_SIGNED" && (
						<CodingPanel
							encounterId={latestEncounter.id}
							coding={coding}
							providerNoteAvailable={!!latestEncounter.providerNoteUrl}
							onChange={setCoding}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function Row({
	label,
	value,
	mono = false,
	chipTone,
}: {
	label: string;
	value: string;
	mono?: boolean;
	chipTone?: "ok" | "warn" | "dnr" | "neutral";
}) {
	return (
		<div className="flex items-center gap-3 px-4 py-2.5">
			<div className="label-kicker w-[120px] shrink-0">{label}</div>
			{chipTone ? (
				<Chip tone={chipTone}>{value}</Chip>
			) : (
				<div
					className={cls(
						"text-[12.5px] text-n-800 truncate",
						mono && "font-mono",
					)}
				>
					{value}
				</div>
			)}
		</div>
	);
}

function DocumentLink({
	label,
	url,
	missingText,
}: {
	label: string;
	url?: string | null;
	missingText: string;
}) {
	if (!url) {
		return (
			<div className="flex items-center gap-3 text-[12.5px] text-n-500">
				<FileText className="w-4 h-4 text-n-400" />
				<span className="flex-1">{label}</span>
				<span className="font-mono text-[10.5px] uppercase tracking-wider">
					{missingText}
				</span>
			</div>
		);
	}
	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			className="group flex items-center gap-3 text-[12.5px] text-n-800 hover:text-n-900 transition"
		>
			<FileText className="w-4 h-4 text-p-600" />
			<span className="flex-1">{label}</span>
			<span className="font-mono text-[10.5px] uppercase tracking-wider text-n-500 group-hover:text-n-900 inline-flex items-center gap-1">
				Open
				<ExternalLink className="w-3 h-3" />
			</span>
		</a>
	);
}

function EncounterRow({ encounter }: { encounter: EncounterDetail }) {
	return (
		<div className="px-4 py-2.5 flex items-center gap-3 text-[13px]">
			<CheckCircle2
				className={cls(
					"w-3.5 h-3.5 shrink-0",
					encounter.noteStatus === "FOUND_SIGNED"
						? "text-[var(--ok-fg)]"
						: "text-n-400",
				)}
			/>
			<div className="flex-1 min-w-0">
				<div className="text-n-800 truncate">
					{encounter.type === "CONSULT"
						? "Consult"
						: encounter.type === "PROGRESS"
							? "Follow-up"
							: "Procedure"}
					<span className="text-n-500"> · enc #{encounter.id}</span>
				</div>
				<div className="font-mono text-[10.5px] text-n-500">
					{formatDate(encounter.dateOfService)}
				</div>
			</div>
			<Chip tone={NOTE_STATUS_TONE[encounter.noteStatus]}>
				{NOTE_STATUS_LABEL[encounter.noteStatus]}
			</Chip>
		</div>
	);
}

function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}
