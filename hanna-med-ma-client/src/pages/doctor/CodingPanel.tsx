import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	FileText,
	Info,
	Loader2,
	Maximize2,
	Minimize2,
	RefreshCw,
	Shield,
	Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { codingService } from "../../services/codingService";
import type {
	CoderProposal,
	EncounterCoding,
	ReasoningEvent,
} from "../../types/coding";
import { cls } from "../../lib/cls";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { CodeChip } from "../../components/ui/CodeChip";
import { AuditRiskMeter } from "../../components/ui/AuditRiskMeter";
import { ReasoningTimeline } from "../../components/ui/ReasoningTimeline";
import {
	NoteWithHighlights,
	type Highlight,
} from "../../components/ui/NoteWithHighlights";
import { useCodingPolling } from "../../hooks/useCodingPolling";
import { parseMarkdown } from "../../lib/markdown";

interface CodingPanelProps {
	encounterId: number;
	coding: EncounterCoding | null;
	providerNoteAvailable: boolean;
	onChange: (coding: EncounterCoding) => void;
}

const STATUS_TONE = {
	IN_PROGRESS: "info" as const,
	DRAFT: "info" as const,
	UNDER_REVIEW: "warn" as const,
	APPROVED: "ok" as const,
	TRANSFERRED_TO_CARETRACKER: "primary" as const,
	DENIED: "dnr" as const,
	FAILED: "dnr" as const,
};

const STATUS_LABEL = {
	IN_PROGRESS: "running",
	DRAFT: "draft",
	UNDER_REVIEW: "reviewing",
	APPROVED: "approved",
	TRANSFERRED_TO_CARETRACKER: "transferred",
	DENIED: "denied",
	FAILED: "failed",
};

function toHighlights(proposal: CoderProposal): Highlight[] {
	const out: Highlight[] = [];
	for (const c of proposal.cptProposals)
		out.push({ span: c.evidenceSpan, code: c.code, kind: "cpt" });
	for (const i of proposal.icd10Proposals)
		out.push({ span: i.evidenceSpan, code: i.code, kind: "icd10" });
	// Forcing-function evidence spans get pulled in too so the doctor
	// can hover from the right-rail Reasoning panel and see exactly
	// what text the agent quoted to justify each verdict. Filter
	// nulls — limbThreat / surgeryDecision quotes are often null on
	// non-applicable encounters.
	if (proposal.limbThreatAssessment?.evidenceSpan) {
		out.push({
			span: proposal.limbThreatAssessment.evidenceSpan,
			code: "LIMB",
			kind: "cpt",
		});
	}
	if (proposal.limbThreatAssessment?.decisionEvidenceSpan) {
		out.push({
			span: proposal.limbThreatAssessment.decisionEvidenceSpan,
			code: "LIMB-DEC",
			kind: "cpt",
		});
	}
	if (proposal.surgeryDecision?.evidenceSpan) {
		out.push({
			span: proposal.surgeryDecision.evidenceSpan,
			code: "-57",
			kind: "cpt",
		});
	}
	return out;
}

function ReasoningBlock({
	title,
	chips,
	children,
}: {
	title: string;
	chips: Array<{ label: string; tone: "ok" | "warn" | "dnr" | "primary" | "info" } | null>;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="bg-n-0 border border-n-150 rounded-md">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left hover:bg-n-50 transition rounded-md"
			>
				{open ? (
					<ChevronDown className="w-3 h-3 text-n-500 shrink-0" />
				) : (
					<ChevronRight className="w-3 h-3 text-n-500 shrink-0" />
				)}
				<span className="text-[12px] font-medium text-n-800 shrink-0">
					{title}
				</span>
				<div className="flex-1 flex flex-wrap items-center gap-1 justify-end">
					{chips
						.filter((c): c is { label: string; tone: "ok" | "warn" | "dnr" | "primary" | "info" } => Boolean(c))
						.map((c, i) => (
							<Chip key={i} tone={c.tone}>
								{c.label}
							</Chip>
						))}
				</div>
			</button>
			{open && (
				<div className="px-2.5 pb-2.5 pt-0 space-y-2 text-[11.5px] text-n-700 leading-relaxed border-t border-n-150">
					{children}
				</div>
			)}
		</div>
	);
}

function categoryTone(
	cat: "ALWAYS_INITIAL_HOSPITAL" | "ALWAYS_CONSULT" | "DEPENDS_HUMAN_REVIEW",
): "primary" | "info" | "warn" {
	if (cat === "ALWAYS_INITIAL_HOSPITAL") return "primary";
	if (cat === "ALWAYS_CONSULT") return "info";
	return "warn";
}

function levelTone(
	level: "MINIMAL" | "LOW" | "MODERATE" | "HIGH" | "STRAIGHTFORWARD" | "LIMITED" | "EXTENSIVE",
): "ok" | "info" | "warn" | "dnr" {
	if (level === "HIGH" || level === "EXTENSIVE") return "dnr";
	if (level === "MODERATE") return "warn";
	if (level === "LOW" || level === "LIMITED") return "info";
	return "ok";
}

function evidenceTone(
	level: "NONE" | "SUSPECTED_PENDING" | "CONFIRMED",
): "ok" | "warn" | "dnr" {
	if (level === "CONFIRMED") return "dnr";
	if (level === "SUSPECTED_PENDING") return "warn";
	return "ok";
}

export function CodingPanel({
	encounterId,
	coding: initialCoding,
	providerNoteAvailable,
	onChange,
}: CodingPanelProps) {
	const [approving, setApproving] = useState(false);
	const [attested, setAttested] = useState(false);
	const [selectedCode, setSelectedCode] = useState<string | null>(null);
	const [fullscreen, setFullscreen] = useState(false);
	const [reasoningOpen, setReasoningOpen] = useState(false);
	// Bumped on Re-run so the polling hook re-fetches and resumes
	// polling on the newly-enqueued IN_PROGRESS row.
	const [refetchKey, setRefetchKey] = useState(0);
	const [starting, setStarting] = useState(false);

	// Poll the server for the latest coding. The hook itself decides
	// when to stop (terminal status). We ALWAYS enable it when a note
	// is available so a run kicked off from another tab / session is
	// reflected here too.
	const { coding: polled } = useCodingPolling(encounterId, {
		enabled: providerNoteAvailable,
		refetchKey,
	});

	// Prefer the polled row once it arrives; fall back to the one the
	// parent passed in for the first render.
	const coding = polled ?? initialCoding;

	// Tell the parent whenever the row transitions — keeps the parent's
	// state in sync so sidebars etc. can reflect the current status.
	useEffect(() => {
		if (polled) onChange(polled);
		// Only react to meaningful identity/status changes; avoids
		// firing on every polling tick that merely updated reasoningLog.
	}, [polled?.id, polled?.status, polled?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

	// Escape exits fullscreen + page scroll gets locked while the
	// overlay is up so the body doesn't creep around behind it.
	useEffect(() => {
		if (!fullscreen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setFullscreen(false);
		};
		window.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			window.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [fullscreen]);

	const proposal = coding?.proposal ?? null;
	const noteText = proposal?.noteText ?? "";
	const events: ReasoningEvent[] = coding?.reasoningLog ?? [];
	const isRunning = coding?.status === "IN_PROGRESS";
	const hasFailed = coding?.status === "FAILED";

	const handleGenerate = async () => {
		setStarting(true);
		try {
			await codingService.generate(encounterId);
			toast.success("AI Coder started — this usually takes a few minutes.");
			// Reset attestation + bump the refetch key so the hook
			// immediately fetches the new IN_PROGRESS row.
			setAttested(false);
			setReasoningOpen(false);
			setRefetchKey((k) => k + 1);
		} catch (e: unknown) {
			const err = e as { response?: { data?: { message?: string } } };
			toast.error(
				err.response?.data?.message || "Could not start AI Coder run",
			);
		} finally {
			setStarting(false);
		}
	};

	const handleApprove = async () => {
		if (!coding) return;
		setApproving(true);
		try {
			const updated = await codingService.approve(coding.id);
			onChange(updated);
			toast.success("Signed off");
		} catch (e: unknown) {
			const err = e as { response?: { data?: { message?: string } } };
			toast.error(err.response?.data?.message || "Approve failed");
		} finally {
			setApproving(false);
		}
	};

	// ── State 0: no signed note yet ──────────────────────────────────
	if (!providerNoteAvailable) {
		return (
			<section className="bg-n-0 border border-dashed border-n-200 rounded-lg p-4">
				<div className="flex items-center gap-2 mb-1.5">
					<Sparkles className="w-4 h-4 text-n-400" />
					<div className="font-serif text-[14px] text-n-900">AI Coder</div>
				</div>
				<p className="text-[12.5px] text-n-600 leading-relaxed">
					Waiting for the signed provider note. Once the RPA downloads it
					(usually within 24h of the encounter), the AI will propose CPT +
					ICD-10 codes with evidence.
				</p>
			</section>
		);
	}

	// ── State 1: never run ───────────────────────────────────────────
	if (!coding) {
		return (
			<section className="bg-n-0 border border-n-150 rounded-lg p-5 text-center">
				<div className="inline-flex items-center gap-2 mb-2">
					<Sparkles className="w-4 h-4 text-p-600" />
					<div className="font-serif text-[15px] text-n-900">
						AI Coder ready
					</div>
				</div>
				<p className="text-[12.5px] text-n-600 leading-relaxed mb-3 max-w-md mx-auto">
					The signed note is available. Run the AI Coder to generate a
					draft bill with evidence citations, NCCI/MUE/LCD validation, and
					an audit-risk score.
				</p>
				<Button
					tone="primary"
					size="md"
					onClick={handleGenerate}
					disabled={starting}
					leading={
						starting ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<Sparkles className="w-3.5 h-3.5" />
						)
					}
				>
					{starting ? "Starting…" : "Run AI Coder"}
				</Button>
				<div className="font-mono text-[10.5px] text-n-500 mt-2">
					Typical run: 4–6 minutes · agent performs 20–40 tool calls
				</div>
			</section>
		);
	}

	// ── State 2: IN_PROGRESS — live reasoning timeline ───────────────
	if (isRunning) {
		const runningMs = coding.startedAt
			? Date.now() - new Date(coding.startedAt).getTime()
			: 0;
		return (
			<section className="bg-n-0 border border-n-150 rounded-lg overflow-hidden">
				<div className="px-4 py-3 border-b border-n-150 flex items-center gap-3 flex-wrap">
					<div className="flex items-center gap-2">
						<Loader2 className="w-4 h-4 text-p-600 animate-spin" />
						<div className="font-serif text-[15px] text-n-900">
							AI Coder running
						</div>
					</div>
					<Chip tone="info">{STATUS_LABEL.IN_PROGRESS}</Chip>
					<div className="font-mono text-[10.5px] text-n-500">
						{(runningMs / 1000).toFixed(0)}s elapsed · {events.length} events
					</div>
				</div>
				<div className="max-h-[480px] overflow-y-auto custom-scrollbar">
					<ReasoningTimeline events={events} live compact={false} />
				</div>
				<div className="px-4 py-2 border-t border-n-150 font-mono text-[10.5px] text-n-500">
					You can close this panel — the run continues server-side. The
					final proposal will appear here when it finishes.
				</div>
			</section>
		);
	}

	// ── State 3: FAILED — error + retry ──────────────────────────────
	if (hasFailed) {
		return (
			<section className="bg-n-0 border border-[var(--dnr-fg)]/30 rounded-lg overflow-hidden">
				<div className="px-4 py-3 border-b border-n-150 flex items-center gap-3">
					<AlertTriangle className="w-4 h-4 text-[var(--dnr-fg)]" />
					<div className="font-serif text-[15px] text-n-900">
						AI Coder failed
					</div>
					<Chip tone="dnr">{STATUS_LABEL.FAILED}</Chip>
					<Button
						tone="ghost"
						size="sm"
						className="ml-auto"
						onClick={handleGenerate}
						disabled={starting}
						leading={<RefreshCw className="w-3.5 h-3.5" />}
					>
						{starting ? "Starting…" : "Retry"}
					</Button>
				</div>
				{coding.errorMessage && (
					<div className="px-4 py-3 font-mono text-[11.5px] text-n-700 whitespace-pre-wrap border-b border-n-150">
						{coding.errorMessage}
					</div>
				)}
				{events.length > 0 && (
					<div className="max-h-[360px] overflow-y-auto custom-scrollbar">
						<ReasoningTimeline events={events} compact={false} />
					</div>
				)}
			</section>
		);
	}

	// ── State 4: terminal but no proposal (shouldn't happen now, but guard) ──
	if (!proposal || !("primaryCpt" in proposal)) {
		return (
			<section className="bg-n-0 border border-warn-fg/30 rounded-lg p-4">
				<div className="flex items-center gap-2 mb-1.5">
					<AlertTriangle className="w-4 h-4 text-[var(--warn-fg)]" />
					<div className="font-serif text-[14px] text-n-900">
						AI Coder ran but did not finalize
					</div>
				</div>
				<p className="text-[12.5px] text-n-600 leading-relaxed">
					The agent finished without calling{" "}
					<span className="font-mono">finalize_coding</span>. Try again —
					this is usually a transient issue.
				</p>
				<Button
					tone="ghost"
					size="sm"
					onClick={handleGenerate}
					disabled={starting}
					leading={<RefreshCw className="w-3.5 h-3.5" />}
					className="mt-3"
				>
					{starting ? "Re-running…" : "Re-run"}
				</Button>
			</section>
		);
	}

	const highlights = toHighlights(proposal);
	const statusKey = coding.status as keyof typeof STATUS_TONE;

	// The whole panel body. When fullscreen=true we render it through
	// a portal to <body> so no ancestor transform/filter can pin the
	// "fixed" to a parent (which was leaving a gap at the top and
	// clipping scroll). When not fullscreen, it renders inline.
	const body = (
		<section
			className={cls(
				"bg-n-0 border border-n-150 rounded-lg overflow-hidden",
				fullscreen &&
					"fixed inset-0 z-[60] rounded-none border-0 flex flex-col bg-n-0",
			)}
		>
			{/* Header */}
			<div className="px-4 py-3 border-b border-n-150 flex items-center gap-3 flex-wrap shrink-0">
				<div className="flex items-center gap-2">
					<Sparkles className="w-4 h-4 text-p-600" />
					<div className="font-serif text-[15px] text-n-900">AI Coder</div>
				</div>
				<Chip tone={STATUS_TONE[statusKey]}>{STATUS_LABEL[statusKey]}</Chip>
				<div className="ml-auto flex items-center gap-1.5">
					<Button
						tone="ghost"
						size="sm"
						onClick={handleGenerate}
						disabled={starting}
						leading={
							starting ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<RefreshCw className="w-3.5 h-3.5" />
							)
						}
					>
						{starting ? "Starting…" : "Re-run"}
					</Button>
					<Button
						tone="ghost"
						size="sm"
						onClick={() => setFullscreen((v) => !v)}
						leading={
							fullscreen ? (
								<Minimize2 className="w-3.5 h-3.5" />
							) : (
								<Maximize2 className="w-3.5 h-3.5" />
							)
						}
						aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
					>
						{fullscreen ? "Exit" : "Fullscreen"}
					</Button>
				</div>
			</div>

			{/* Column layout: flex-col on mobile (sections stack with
			    page-level scroll), flex-row on xl. When fullscreen,
			    the whole container fills the remaining viewport height
			    (flex-1 min-h-0) so each xl column's inner overflow-y
			    works against a bounded height. At stacked mobile
			    fullscreen, we let the section itself scroll because
			    splitting scroll between 3 internal areas is jarring. */}
			<div
				className={cls(
					"flex flex-col xl:flex-row",
					fullscreen &&
						"flex-1 min-h-0 overflow-y-auto xl:overflow-hidden custom-scrollbar",
				)}
			>
				{/* ── Col 1 — Note with highlights ───────────────────── */}
				<div
					className={cls(
						"border-b xl:border-b-0 xl:border-r border-n-150 flex flex-col min-w-0 xl:flex-1",
						fullscreen
							? "xl:max-h-none"
							: "max-h-[600px] xl:max-h-[720px]",
					)}
				>
					<div className="h-11 shrink-0 px-4 border-b border-n-150 flex items-center gap-3 whitespace-nowrap">
						<FileText className="w-3.5 h-3.5 text-n-500 shrink-0" />
						<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 truncate">
							Provider note
						</div>
						<div className="ml-auto flex items-center gap-2 text-[10px] font-mono text-n-500 shrink-0">
							<span className="inline-flex items-center gap-1">
								<span className="inline-block w-2 h-2 rounded-sm bg-[var(--info-bg)] border border-[var(--info-fg)]/30" />
								CPT
							</span>
							<span className="inline-flex items-center gap-1">
								<span className="inline-block w-2 h-2 rounded-sm bg-[var(--p-100)] border border-[var(--p-300)]" />
								ICD-10
							</span>
						</div>
					</div>
					<div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
						{noteText ? (
							<NoteWithHighlights
								noteText={noteText}
								highlights={highlights}
								selectedCode={selectedCode}
								onCodeClick={(code) =>
									setSelectedCode((c) => (c === code ? null : code))
								}
							/>
						) : (
							<p className="font-mono text-[11px] text-n-500">
								Note text not attached to this proposal. Re-run to fix.
							</p>
						)}
					</div>
				</div>

				{/* ── Col 2 — Suggested bill ─────────────────────────── */}
				<div
					className={cls(
						"border-b xl:border-b-0 xl:border-r border-n-150 flex flex-col min-w-0 xl:w-[320px] xl:shrink-0",
						fullscreen
							? "xl:max-h-none"
							: "max-h-[600px] xl:max-h-[720px]",
					)}
				>
					<div className="h-11 shrink-0 px-4 border-b border-n-150 flex items-center">
						<div className="font-semibold text-[13px] text-n-900">
							Suggested bill
						</div>
					</div>
					<div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
						{/* CPT section */}
						<div>
							<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
								CPT · {proposal.cptProposals.length}
							</div>
							<div className="border border-n-200 rounded-md divide-y divide-n-150">
								{proposal.cptProposals.map((cpt) => {
									const isSel = selectedCode === cpt.code;
									return (
										<button
											key={cpt.code + cpt.modifiers.join(",")}
											onClick={() =>
												setSelectedCode((c) =>
													c === cpt.code ? null : cpt.code,
												)
											}
											className={cls(
												"w-full text-left px-2.5 py-2 flex items-start gap-2",
												isSel ? "bg-p-50" : "hover:bg-n-50 transition",
											)}
										>
											<CodeChip
												code={cpt.code}
												modifier={cpt.modifiers}
												tone="primary"
											/>
											<div className="flex-1 min-w-0">
												<div className="text-[12.5px] text-n-800 leading-tight">
													{parseMarkdown(cpt.rationale)}
												</div>
												<div className="font-mono text-[10.5px] text-n-500 mt-1 flex items-center gap-2">
													<span>units · {cpt.units}</span>
													{cpt.pos && (
														<>
															<span className="text-n-300">·</span>
															<span>POS {cpt.pos}</span>
														</>
													)}
												</div>
											</div>
										</button>
									);
								})}
							</div>
						</div>

						{/* ICD-10 section */}
						<div>
							<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
								ICD-10 · {proposal.icd10Proposals.length}
							</div>
							<div className="flex flex-wrap gap-1.5">
								{proposal.icd10Proposals.map((icd) => (
									<CodeChip
										key={icd.code}
										code={icd.code}
										tone="primary"
										onClick={() =>
											setSelectedCode((c) =>
												c === icd.code ? null : icd.code,
											)
										}
										className={
											selectedCode === icd.code
												? "ring-2 ring-p-500 ring-offset-1"
												: undefined
										}
									/>
								))}
							</div>
						</div>

						{/* Gaps */}
						{proposal.documentationGaps.length > 0 && (
							<div>
								<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
									Documentation gaps
								</div>
								<div className="space-y-1.5">
									{proposal.documentationGaps.map((g, i) => (
										<div
											key={i}
											className="border border-[var(--warn-fg)]/30 bg-[var(--warn-bg)]/40 rounded-md px-3 py-2 text-[12px] text-n-800"
										>
											<div className="flex items-start gap-1.5 font-medium">
												<AlertTriangle className="w-3.5 h-3.5 text-[var(--warn-fg)] mt-0.5 shrink-0" />
												<div className="flex-1 min-w-0">
													<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-0.5">
														For {g.forCode}
													</div>
													<div>{parseMarkdown(g.missingElement)}</div>
												</div>
											</div>
											<div className="text-[11px] text-n-600 mt-1.5 leading-relaxed pl-5">
												<div className="font-mono uppercase tracking-wider text-[9.5px] text-n-500 mb-0.5">
													Suggest
												</div>
												{parseMarkdown(g.suggestedLanguage)}
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Provider questions */}
						{proposal.providerQuestions.length > 0 && (
							<div>
								<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
									Provider questions
								</div>
								<div className="space-y-1.5">
									{proposal.providerQuestions.map((q, i) => (
										<div
											key={i}
											className="border border-n-200 rounded-md px-3 py-2 text-[12.5px] text-n-800 flex items-start gap-2"
										>
											<Info className="w-3.5 h-3.5 text-[var(--info-fg)] mt-0.5 shrink-0" />
											<div className="flex-1 min-w-0">
												{parseMarkdown(q)}
											</div>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				</div>

				{/* ── Col 3 — Defense ────────────────────────────────── */}
				<div
					className={cls(
						"flex flex-col bg-n-50 min-w-0 xl:w-[280px] xl:shrink-0",
						fullscreen
							? "xl:max-h-none"
							: "max-h-[600px] xl:max-h-[720px]",
					)}
				>
					<div className="h-11 shrink-0 px-4 border-b border-n-150 flex items-center gap-2">
						<div className="font-semibold text-[13px] text-n-900">Defense</div>
						<Shield className="w-3.5 h-3.5 text-n-500 ml-auto" />
					</div>
					<div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
						<AuditRiskMeter
							score={proposal.auditRiskScore}
							band={proposal.riskBand}
							explanation={proposal.summary}
						/>

						{/* Breakdown */}
						{proposal.riskBreakdown.length > 0 && (
							<div>
								<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
									Breakdown
								</div>
								<div className="divide-y divide-n-150 bg-n-0 border border-n-150 rounded-md">
									{proposal.riskBreakdown.map((b, i) => (
										<div key={i} className="px-2.5 py-1.5 text-[12px]">
											<div className="flex items-center justify-between gap-2">
												<span className="text-n-700">{b.dimension}</span>
												<Chip
													tone={
														b.verdict === "ok"
															? "ok"
															: b.verdict === "partial"
																? "warn"
																: "dnr"
													}
												>
													{b.verdict}
												</Chip>
											</div>
											{b.note && (
												<div className="text-[11.5px] text-n-600 mt-1 leading-relaxed">
													{parseMarkdown(b.note)}
												</div>
											)}
										</div>
									))}
								</div>
							</div>
						)}

						{/* Reasoning — forcing-function audit trail */}
						<div>
							<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
								Reasoning
							</div>
							<div className="space-y-1.5">
								{/* Payer Analysis */}
								<ReasoningBlock
									title="Payer"
									chips={[
										{
											label: proposal.payerAnalysis.category.replace(/_/g, " "),
											tone: categoryTone(proposal.payerAnalysis.category),
										},
										{
											label: proposal.payerAnalysis.eligibleFamily,
											tone: "info",
										},
									]}
								>
									<div>
										<span className="text-n-500">Payer · </span>
										<span className="font-medium">
											{proposal.payerAnalysis.payerNameOnFaceSheet ?? "—"}
										</span>
										{proposal.payerAnalysis.patientAge != null && (
											<span className="text-n-500">
												{" "}
												· age {proposal.payerAnalysis.patientAge}
											</span>
										)}
									</div>
									<div>
										<span className="text-n-500">Match · </span>
										<span className="font-mono text-[11px]">
											{proposal.payerAnalysis.matchType}
										</span>
										{proposal.payerAnalysis.ruleId != null && (
											<span className="text-n-500">
												{" "}
												· rule #{proposal.payerAnalysis.ruleId}
											</span>
										)}
									</div>
									{proposal.payerAnalysis.source && (
										<div className="text-n-500 italic">
											{proposal.payerAnalysis.source}
										</div>
									)}
									{proposal.payerAnalysis.notApplicableReason && (
										<div className="text-n-600">
											{parseMarkdown(proposal.payerAnalysis.notApplicableReason)}
										</div>
									)}
								</ReasoningBlock>

								{/* MDM */}
								<ReasoningBlock
									title="MDM (2-of-3)"
									chips={[
										{
											label: `final · ${proposal.mdm.finalLevel}`,
											tone: levelTone(proposal.mdm.finalLevel),
										},
									]}
								>
									{proposal.mdm.notApplicableReason ? (
										<div className="text-n-600 italic">
											{parseMarkdown(proposal.mdm.notApplicableReason)}
										</div>
									) : (
										<>
											<div>
												<span className="text-n-500">Problems · </span>
												<Chip tone={levelTone(proposal.mdm.problems)}>
													{proposal.mdm.problems}
												</Chip>
											</div>
											<div className="text-n-600 pl-3 -mt-1">
												{parseMarkdown(proposal.mdm.problemsRationale)}
											</div>
											<div>
												<span className="text-n-500">Data · </span>
												<Chip tone={levelTone(proposal.mdm.data)}>
													{proposal.mdm.data}
												</Chip>
											</div>
											<div className="text-n-600 pl-3 -mt-1">
												{parseMarkdown(proposal.mdm.dataRationale)}
											</div>
											<div>
												<span className="text-n-500">Risk · </span>
												<Chip tone={levelTone(proposal.mdm.risk)}>
													{proposal.mdm.risk}
												</Chip>
											</div>
											<div className="text-n-600 pl-3 -mt-1">
												{parseMarkdown(proposal.mdm.riskRationale)}
											</div>
											<div className="border-t border-n-150 pt-2 text-n-700">
												<span className="font-mono text-[10px] uppercase tracking-widest text-n-500 block mb-0.5">
													2-of-3
												</span>
												{parseMarkdown(proposal.mdm.twoOfThreeJustification)}
											</div>
										</>
									)}
								</ReasoningBlock>

								{/* Limb threat — specialty-gated: only render when the
								    active specialty filled this block. Specialties without
								    limb-threat scope (Internal Medicine, Cardiology, etc.)
								    will leave it null/undefined and the panel just hides
								    the row entirely. */}
								{proposal.limbThreatAssessment ? (
									proposal.limbThreatAssessment.applicable ||
									proposal.limbThreatAssessment.evidenceLevel !== "NONE" ? (
										<ReasoningBlock
											title="Limb threat"
											chips={[
												{
													label: proposal.limbThreatAssessment.evidenceLevel.replace(
														/_/g,
														" ",
													),
													tone: evidenceTone(
														proposal.limbThreatAssessment.evidenceLevel,
													),
												},
												proposal.limbThreatAssessment.surgicalDecisionStatus !==
												"NOT_APPLICABLE"
													? {
															label:
																proposal.limbThreatAssessment.surgicalDecisionStatus.replace(
																	/_/g,
																	" ",
																),
															tone:
																proposal.limbThreatAssessment.surgicalDecisionStatus ===
																"DECIDED_AND_SCHEDULED"
																	? "dnr"
																	: "warn",
														}
													: null,
											]}
										>
											{proposal.limbThreatAssessment.evidenceSpan && (
												<div className="border-l-2 border-n-300 pl-2 italic text-n-600">
													{proposal.limbThreatAssessment.evidenceSpan}
												</div>
											)}
											{proposal.limbThreatAssessment.decisionEvidenceSpan && (
												<div className="border-l-2 border-p-300 pl-2 italic text-n-600">
													{proposal.limbThreatAssessment.decisionEvidenceSpan}
												</div>
											)}
											<div className="text-n-700">
												{parseMarkdown(proposal.limbThreatAssessment.rationale)}
											</div>
										</ReasoningBlock>
									) : (
										<ReasoningBlock
											title="Limb threat"
											chips={[{ label: "n/a", tone: "ok" }]}
										>
											<div className="text-n-600 italic">
												{parseMarkdown(proposal.limbThreatAssessment.rationale)}
											</div>
										</ReasoningBlock>
									)
								) : null}

								{/* Surgery decision (-57) */}
								<ReasoningBlock
									title="Surgery decision"
									chips={[
										{
											label: proposal.surgeryDecision.evaluatedThisVisit
												? "decision this visit"
												: "no decision this visit",
											tone: proposal.surgeryDecision.evaluatedThisVisit
												? "dnr"
												: "ok",
										},
										proposal.surgeryDecision.modifier57Applied
											? { label: "-57 applied", tone: "primary" }
											: null,
									]}
								>
									{proposal.surgeryDecision.evidenceSpan && (
										<div className="border-l-2 border-p-300 pl-2 italic text-n-600">
											{proposal.surgeryDecision.evidenceSpan}
										</div>
									)}
									<div className="text-n-700">
										{parseMarkdown(proposal.surgeryDecision.reasoning)}
									</div>
								</ReasoningBlock>
							</div>
						</div>

						{/* LCD citations */}
						{proposal.lcdCitations.length > 0 && (
							<div>
								<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
									LCD citations · {proposal.lcdCitations.length}
								</div>
								<div className="space-y-1.5">
									{proposal.lcdCitations.map((c, i) => (
										<div
											key={i}
											className="bg-n-0 border border-n-150 rounded-md p-2.5"
										>
											<div className="flex items-center gap-1.5 text-[12px] text-n-900 font-medium">
												<span className="font-mono text-[10.5px] text-p-700">
													L{c.lcdId}
												</span>
												<span className="truncate">{c.lcdTitle}</span>
											</div>
											<div className="text-[11px] text-n-600 mt-1 leading-relaxed max-h-32 overflow-y-auto custom-scrollbar italic">
												{parseMarkdown(c.relevantExcerpt)}
											</div>
											{c.articleId && (
												<div className="font-mono text-[10px] text-n-500 mt-1">
													via article A{c.articleId}
												</div>
											)}
										</div>
									))}
								</div>
							</div>
						)}

						{/* Audit risk notes */}
						{proposal.auditRiskNotes.length > 0 && (
							<div>
								<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
									Risk notes
								</div>
								<ul className="text-[11.5px] text-n-700 space-y-2 leading-relaxed">
									{proposal.auditRiskNotes.map((n, i) => (
										<li key={i} className="flex gap-1.5">
											<span className="text-n-400 mt-0.5">·</span>
											<div className="flex-1 min-w-0">
												{parseMarkdown(n)}
											</div>
										</li>
									))}
								</ul>
							</div>
						)}

						{/* Sign-off */}
						{coding.status !== "APPROVED" &&
							coding.status !== "TRANSFERRED_TO_CARETRACKER" && (
								<div className="pt-3 border-t border-n-150">
									<label className="flex gap-2 text-[11.5px] text-n-700 leading-[1.55] mb-3">
										<input
											type="checkbox"
											checked={attested}
											onChange={(e) => setAttested(e.target.checked)}
											className="mt-0.5 accent-p-600"
										/>
										I attest the codes reflect services personally performed
										and documented.
									</label>
									<Button
										tone="primary"
										size="md"
										className="w-full justify-center"
										onClick={handleApprove}
										disabled={!attested || approving}
										leading={
											approving ? (
												<Loader2 className="w-3.5 h-3.5 animate-spin" />
											) : (
												<CheckCircle2 className="w-3.5 h-3.5" />
											)
										}
									>
										{approving ? "Signing…" : "Sign off & submit"}
									</Button>
								</div>
							)}
					</div>
				</div>
			</div>

			{/* Reasoning log — collapsible history of the run */}
			{events.length > 0 && (
				<div className="border-t border-n-150 shrink-0">
					<button
						type="button"
						onClick={() => setReasoningOpen((v) => !v)}
						className="w-full flex items-center gap-2 px-4 py-2 hover:bg-n-50 transition text-left"
					>
						{reasoningOpen ? (
							<ChevronDown className="w-3.5 h-3.5 text-n-500" />
						) : (
							<ChevronRight className="w-3.5 h-3.5 text-n-500" />
						)}
						<div className="font-mono text-[10px] uppercase tracking-widest text-n-500">
							Reasoning log
						</div>
						<div className="font-mono text-[10.5px] text-n-500">
							{events.length} events
						</div>
					</button>
					{reasoningOpen && (
						<div className="max-h-[400px] overflow-y-auto custom-scrollbar border-t border-n-150">
							<ReasoningTimeline events={events} compact={false} />
						</div>
					)}
				</div>
			)}

			{/* Run metadata — always visible as a slim footer */}
			<div className="px-4 py-2 border-t border-n-150 flex items-center gap-3 flex-wrap font-mono text-[10.5px] text-n-500 shrink-0">
				<span>
					primary <span className="text-n-800">{proposal.primaryCpt}</span>
				</span>
				{typeof coding.toolCallCount === "number" && (
					<>
						<span className="text-n-300">·</span>
						<span>{coding.toolCallCount} tool calls</span>
					</>
				)}
				{typeof coding.runDurationMs === "number" && (
					<>
						<span className="text-n-300">·</span>
						<span>{(coding.runDurationMs / 1000).toFixed(1)}s</span>
					</>
				)}
				{coding.createdAt && (
					<>
						<span className="text-n-300">·</span>
						<span>{new Date(coding.createdAt).toLocaleString()}</span>
					</>
				)}
			</div>
		</section>
	);

	// Portal the overlay to <body> so no ancestor transform/filter
	// can pin the "fixed" position to a nested containing block.
	return fullscreen ? createPortal(body, document.body) : body;
}
