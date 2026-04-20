import { useState } from "react";
import {
	AlertTriangle,
	CheckCircle2,
	FileText,
	Info,
	Loader2,
	RefreshCw,
	Shield,
	Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { codingService } from "../../services/codingService";
import type {
	CoderProposal,
	EncounterCoding,
} from "../../types/coding";
import { cls } from "../../lib/cls";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { CodeChip } from "../../components/ui/CodeChip";
import { AuditRiskMeter } from "../../components/ui/AuditRiskMeter";
import {
	NoteWithHighlights,
	type Highlight,
} from "../../components/ui/NoteWithHighlights";

interface CodingPanelProps {
	encounterId: number;
	coding: EncounterCoding | null;
	providerNoteAvailable: boolean;
	onChange: (coding: EncounterCoding) => void;
}

const STATUS_TONE = {
	DRAFT: "info" as const,
	UNDER_REVIEW: "warn" as const,
	APPROVED: "ok" as const,
	TRANSFERRED_TO_CARETRACKER: "primary" as const,
	DENIED: "dnr" as const,
};

const STATUS_LABEL = {
	DRAFT: "draft",
	UNDER_REVIEW: "reviewing",
	APPROVED: "approved",
	TRANSFERRED_TO_CARETRACKER: "transferred",
	DENIED: "denied",
};

function toHighlights(proposal: CoderProposal): Highlight[] {
	const out: Highlight[] = [];
	for (const c of proposal.cptProposals)
		out.push({ span: c.evidenceSpan, code: c.code, kind: "cpt" });
	for (const i of proposal.icd10Proposals)
		out.push({ span: i.evidenceSpan, code: i.code, kind: "icd10" });
	return out;
}

export function CodingPanel({
	encounterId,
	coding,
	providerNoteAvailable,
	onChange,
}: CodingPanelProps) {
	const [generating, setGenerating] = useState(false);
	const [approving, setApproving] = useState(false);
	const [attested, setAttested] = useState(false);
	const [selectedCode, setSelectedCode] = useState<string | null>(null);

	const proposal = coding?.proposal ?? null;
	const noteText = proposal?.noteText ?? "";

	const handleGenerate = async () => {
		setGenerating(true);
		try {
			const res = await codingService.generate(encounterId);
			// Server returns the new DRAFT — re-fetch the full row
			// shape (status, timestamps, etc.) via getLatest.
			const latest = await codingService.getLatest(encounterId);
			if (latest) {
				onChange(latest);
				toast.success(
					res.proposal
						? `AI Coder proposed ${res.proposal.primaryCpt}`
						: "Coder ran but did not finalize — see raw output",
				);
			}
		} catch (e: unknown) {
			const err = e as { response?: { data?: { message?: string } } };
			toast.error(
				err.response?.data?.message || "AI Coder failed — check server logs",
			);
		} finally {
			setGenerating(false);
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
					disabled={generating}
					leading={
						generating ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<Sparkles className="w-3.5 h-3.5" />
						)
					}
				>
					{generating ? "Running AI Coder…" : "Run AI Coder"}
				</Button>
				{generating && (
					<div className="font-mono text-[10.5px] text-n-500 mt-2">
						Typical run: ~60 seconds · agent performs 20–30 tool calls
					</div>
				)}
			</section>
		);
	}

	// A proposal exists — render the 3-column layout (stacks on mobile).
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
					disabled={generating}
					leading={<RefreshCw className="w-3.5 h-3.5" />}
					className="mt-3"
				>
					{generating ? "Re-running…" : "Re-run"}
				</Button>
			</section>
		);
	}

	const highlights = toHighlights(proposal);

	return (
		<section className="bg-n-0 border border-n-150 rounded-lg overflow-hidden">
			{/* Header */}
			<div className="px-4 py-3 border-b border-n-150 flex items-center gap-3 flex-wrap">
				<div className="flex items-center gap-2">
					<Sparkles className="w-4 h-4 text-p-600" />
					<div className="font-serif text-[15px] text-n-900">AI Coder</div>
				</div>
				<Chip tone={STATUS_TONE[coding.status]}>
					{STATUS_LABEL[coding.status]}
				</Chip>
				<div className="ml-auto flex items-center gap-1.5">
					<Button
						tone="ghost"
						size="sm"
						onClick={handleGenerate}
						disabled={generating}
						leading={
							generating ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<RefreshCw className="w-3.5 h-3.5" />
							)
						}
					>
						{generating ? "Running…" : "Re-run"}
					</Button>
				</div>
			</div>

			{/* 3-column only on xl+ (≥1280px, where there's room for
			    480+300+260 of content). Below that the panel stacks
			    vertically so each section is readable on its own. */}
			<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px_260px]">
				{/* ── Col 1 — Note with highlights ───────────────────── */}
				<div className="border-b xl:border-b-0 xl:border-r border-n-150 flex flex-col max-h-[600px] xl:max-h-[720px] min-w-0">
					<div className="px-4 py-2.5 border-b border-n-150 flex items-center gap-3 whitespace-nowrap">
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
				<div className="border-b xl:border-b-0 xl:border-r border-n-150 flex flex-col max-h-[600px] xl:max-h-[720px] min-w-0">
					<div className="px-4 py-2.5 border-b border-n-150">
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
													{cpt.rationale}
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
											<div className="flex items-center gap-1.5 font-medium">
												<AlertTriangle className="w-3.5 h-3.5 text-[var(--warn-fg)]" />
												For {g.forCode} — {g.missingElement}
											</div>
											<div className="font-mono text-[10.5px] text-n-600 mt-1.5 leading-relaxed">
												suggest: {g.suggestedLanguage}
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
											<span>{q}</span>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				</div>

				{/* ── Col 3 — Defense ────────────────────────────────── */}
				<div className="flex flex-col bg-n-50 max-h-[600px] xl:max-h-[720px] min-w-0">
					<div className="px-4 py-2.5 border-b border-n-150 flex items-center gap-2">
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
										<div
											key={i}
											className="flex items-center justify-between px-2.5 py-1.5 text-[12px]"
										>
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
									))}
								</div>
							</div>
						)}

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
											<div className="font-mono text-[10.5px] text-n-600 mt-1 leading-relaxed max-h-24 overflow-y-auto custom-scrollbar">
												"{c.relevantExcerpt}"
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
								<ul className="text-[11.5px] text-n-700 space-y-1 leading-relaxed">
									{proposal.auditRiskNotes.map((n, i) => (
										<li key={i} className="flex gap-1.5">
											<span className="text-n-400">·</span>
											<span>{n}</span>
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

			{/* Run metadata — always visible as a slim footer */}
			<div className="px-4 py-2 border-t border-n-150 flex items-center gap-3 flex-wrap font-mono text-[10.5px] text-n-500">
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
}
