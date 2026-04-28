import { useEffect, useMemo, useRef } from "react";
import { ArrowRight, Brain, CheckCircle2 } from "lucide-react";
import type { ReasoningEvent } from "../../types/coding";
import { cls } from "../../lib/cls";
import { parseMarkdown } from "../../lib/markdown";

/**
 * Walk up the DOM from `el` and return the closest ancestor whose
 * computed `overflow-y` is auto/scroll/overlay. The timeline owns
 * the auto-scroll behavior but the actual scroll container lives
 * one level up (the `max-h-[480px] overflow-y-auto` wrapper in
 * CodingPanel), so we have to find it dynamically rather than
 * own a fixed-height container ourselves.
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
	let cur: HTMLElement | null = el?.parentElement ?? null;
	while (cur) {
		const s = window.getComputedStyle(cur).overflowY;
		if (s === "auto" || s === "scroll" || s === "overlay") return cur;
		cur = cur.parentElement;
	}
	return null;
}

// Distance from the bottom (px) within which we consider the user
// "still pinned" to the live tail. Anything beyond this means the
// user deliberately scrolled up to read history — respect that
// intent and stop auto-scrolling until they return to the bottom.
const STICK_TO_BOTTOM_THRESHOLD = 80;

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

	// Auto-scroll machinery — only active when `live`. The sentinel
	// is an empty div at the very end of the list; we scroll it into
	// view whenever the event count grows, but only if the user is
	// already "stuck" at the bottom. A scroll listener on the
	// scrollable ancestor flips `stickRef` to false the moment the
	// user scrolls up beyond the threshold, so reading history isn't
	// disrupted by incoming events. Returning to the bottom flips it
	// back to true, restoring the live-tail behavior automatically.
	const containerRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);

	useEffect(() => {
		if (!live) return;
		const scrollEl = findScrollParent(containerRef.current);
		if (!scrollEl) return;
		const onScroll = () => {
			const distance =
				scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
			stickRef.current = distance < STICK_TO_BOTTOM_THRESHOLD;
		};
		// Initial state — assume we start pinned (caller usually mounts
		// the timeline already scrolled to top, but the first effect
		// below will jump us to bottom).
		stickRef.current = true;
		scrollEl.addEventListener("scroll", onScroll, { passive: true });
		return () => scrollEl.removeEventListener("scroll", onScroll);
	}, [live]);

	useEffect(() => {
		if (!live) return;
		if (!stickRef.current) return;
		// Smooth scroll feels right for the live trickle of events
		// (one every few hundred ms); jumps look chaotic in that
		// rhythm. Browsers without smooth-scroll support fall back to
		// instant — that's fine.
		sentinelRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}, [live, rows.length]);

	if (rows.length === 0) {
		return (
			<div
				ref={containerRef}
				className={cls(
					"font-mono text-[11px] text-n-500 px-3 py-2",
					className,
				)}
			>
				{live ? "Waiting for the agent to start…" : "No reasoning recorded."}
				<div ref={sentinelRef} aria-hidden />
			</div>
		);
	}

	return (
		<div ref={containerRef} className={cls("flex flex-col", className)}>
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
			{/* Sentinel for auto-scroll. Stays at the very bottom of the
			    list; the live-mode effect scrolls this into view on each
			    new event when the user is still pinned to the tail. */}
			<div ref={sentinelRef} aria-hidden />
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
