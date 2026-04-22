import { useMemo } from "react";
import { ArrowRight, Brain, CheckCircle2 } from "lucide-react";
import type { ReasoningEvent } from "../../types/coding";
import { cls } from "../../lib/cls";
import { parseMarkdown } from "../../lib/markdown";

/**
 * Format a relative-time string like "+0.8s", "+42s", "+2m 14s".
 * Input is milliseconds since the run started (the `ts` field on each
 * reasoning event).
 */
function formatElapsed(ms: number): string {
	if (ms < 1000) return `+${(ms / 1000).toFixed(1)}s`;
	const totalSec = Math.round(ms / 1000);
	if (totalSec < 60) return `+${totalSec}s`;
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `+${m}m ${s}s`;
}

function renderArgs(args: Record<string, unknown>): string {
	const entries = Object.entries(args);
	if (entries.length === 0) return "()";
	return entries
		.map(([k, v]) => {
			if (typeof v === "string") {
				const q = v.length > 40 ? `${v.slice(0, 40)}…` : v;
				return `${k}="${q}"`;
			}
			if (v == null) return `${k}=null`;
			return `${k}=${JSON.stringify(v)}`;
		})
		.join(", ");
}

interface ReasoningTimelineProps {
	events: ReasoningEvent[];
	/** Show a pulsing "in progress" hint at the bottom of the list. */
	live?: boolean;
	/**
	 * Compact — no-op today, kept for API compatibility. Markdown
	 * content doesn't play nicely with CSS line-clamp so we always
	 * render full height and rely on the container's overflow-y.
	 */
	compact?: boolean;
	className?: string;
}

/**
 * Renders the agent's reasoning timeline — one row per event, icon by
 * type, timestamp on the right. Tool calls are paired with their
 * results where possible (same callId) so the UI reads as "→ args ←
 * summary" instead of two disconnected rows.
 */
export function ReasoningTimeline({
	events,
	live = false,
	compact: _compact = true,
	className,
}: ReasoningTimelineProps) {
	// Pair tool_call + tool_result by callId so each tool appears as
	// one row with both sides. Unpaired calls (still in-flight) show
	// a spinner dot instead of a result.
	const rows = useMemo(() => groupEvents(events), [events]);

	if (rows.length === 0) {
		return (
			<div
				className={cls(
					"font-mono text-[11px] text-n-500 px-3 py-2",
					className,
				)}
			>
				{live ? "Waiting for the agent to start…" : "No reasoning recorded."}
			</div>
		);
	}

	return (
		<div className={cls("flex flex-col", className)}>
			{rows.map((row, idx) => {
				if (row.kind === "think") {
					return (
						<div
							key={`t-${idx}`}
							className="flex gap-3 px-3 py-2 border-b border-n-150 last:border-b-0"
						>
							<Brain className="w-3.5 h-3.5 text-n-500 mt-0.5 shrink-0" />
							<div className="flex-1 min-w-0 text-[12px] text-n-800 leading-[1.55] break-words">
								{parseMarkdown(row.text)}
							</div>
							<div className="font-mono text-[10px] text-n-400 whitespace-nowrap shrink-0">
								{formatElapsed(row.ts)}
							</div>
						</div>
					);
				}
				// Tool row.
				const unresolved = !row.result;
				return (
					<div
						key={`c-${row.callId ?? idx}`}
						className="flex gap-3 px-3 py-2 border-b border-n-150 last:border-b-0"
					>
						{unresolved ? (
							<span className="w-2 h-2 rounded-full bg-[var(--info-fg)] mt-1.5 shrink-0 animate-pulse" />
						) : (
							<CheckCircle2 className="w-3.5 h-3.5 text-[var(--ok-fg)] mt-0.5 shrink-0" />
						)}
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1.5 text-[12px] text-n-900">
								<span className="font-mono text-[11.5px] text-p-700">
									{row.tool}
								</span>
								<ArrowRight className="w-3 h-3 text-n-400" />
								<span className="font-mono text-[10.5px] text-n-500 truncate">
									{renderArgs(row.args)}
								</span>
							</div>
							{row.result && (
								<div className="font-mono text-[10.5px] text-n-600 mt-0.5 leading-relaxed">
									{row.result}
								</div>
							)}
						</div>
						<div className="font-mono text-[10px] text-n-400 whitespace-nowrap shrink-0">
							{formatElapsed(row.ts)}
						</div>
					</div>
				);
			})}
			{live && (
				<div className="flex items-center gap-2 px-3 py-2 text-[11px] text-n-500">
					<span className="w-1.5 h-1.5 rounded-full bg-[var(--info-fg)] animate-pulse" />
					agent working…
				</div>
			)}
		</div>
	);
}

type Row =
	| { kind: "think"; ts: number; text: string }
	| {
			kind: "tool";
			ts: number;
			tool: string;
			args: Record<string, unknown>;
			callId?: string;
			result?: string;
	  };

/**
 * Collapse matched tool_call/tool_result pairs into single "tool"
 * rows. Think events stay as-is. Preserves chronological order by
 * keying on the tool_call's position (results get merged in, they
 * don't create a new row).
 */
function groupEvents(events: ReasoningEvent[]): Row[] {
	const rows: Row[] = [];
	const toolIndex = new Map<string, number>();

	for (const e of events) {
		if (e.type === "think") {
			rows.push({ kind: "think", ts: e.ts, text: e.text });
			continue;
		}
		if (e.type === "tool_call") {
			const idx = rows.length;
			rows.push({
				kind: "tool",
				ts: e.ts,
				tool: e.tool,
				args: e.args,
				callId: e.callId,
			});
			if (e.callId) toolIndex.set(e.callId, idx);
			continue;
		}
		// tool_result — try to merge into the matching tool_call row.
		if (e.callId && toolIndex.has(e.callId)) {
			const idx = toolIndex.get(e.callId)!;
			const existing = rows[idx];
			if (existing.kind === "tool" && !existing.result) {
				existing.result = e.summary;
				continue;
			}
		}
		// Fallback — no matching call id, render as a standalone row.
		rows.push({
			kind: "tool",
			ts: e.ts,
			tool: e.tool,
			args: {},
			callId: e.callId,
			result: e.summary,
		});
	}

	return rows;
}
