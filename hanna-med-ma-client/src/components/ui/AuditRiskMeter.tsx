import { Chip } from "./Chip";
import { parseMarkdown } from "../../lib/markdown";

/**
 * Defense-panel risk gauge: a big score + progress bar + band chip.
 * Matches the Remix "audit-risk score" block so the UI stays in
 * visual lock-step with the design system.
 */
export function AuditRiskMeter({
	score,
	band,
	explanation,
}: {
	score: number;
	band: "LOW" | "REVIEW" | "RISK";
	/** One-line reason the band landed where it did. Optional. */
	explanation?: string;
}) {
	// Color semantics: low=green, review=amber, risk=red.
	const tone = band === "LOW" ? "ok" : band === "REVIEW" ? "warn" : "dnr";
	const bandLabel =
		band === "LOW"
			? "low risk"
			: band === "REVIEW"
				? "needs review"
				: "high risk";
	const barColor =
		band === "LOW"
			? "bg-[var(--ok-fg)]"
			: band === "REVIEW"
				? "bg-[var(--warn-fg)]"
				: "bg-[var(--dnr-fg)]";
	const numberColor =
		band === "LOW"
			? "text-[var(--ok-fg)]"
			: band === "REVIEW"
				? "text-[var(--warn-fg)]"
				: "text-[var(--dnr-fg)]";
	const pct = Math.max(0, Math.min(100, score));

	return (
		<div className="bg-n-0 border border-n-150 rounded-md p-3.5">
			<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-2">
				Audit-risk score
			</div>
			<div className="flex items-end gap-2">
				<div className={`font-serif text-[36px] leading-none ${numberColor}`}>
					{score}
				</div>
				<div className="text-[11.5px] text-n-600 mb-1">/100</div>
				<Chip tone={tone} className="ml-auto">
					{bandLabel}
				</Chip>
			</div>
			<div className="mt-3 h-1 bg-n-150 rounded-full overflow-hidden">
				<div
					className={`h-full ${barColor} transition-all`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			{explanation && (
				<div className="mt-3 text-[11.5px] text-n-600 leading-[1.55]">
					{parseMarkdown(explanation)}
				</div>
			)}
		</div>
	);
}
