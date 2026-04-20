import { useMemo, type ReactNode } from "react";
import { cls } from "../../lib/cls";

export interface Highlight {
	/** Verbatim substring the agent cited from the note. */
	span: string;
	/** The code (CPT / ICD-10) the span is evidence for. */
	code: string;
	/** Coarse bucket so colors stay consistent across the panel. */
	kind: "cpt" | "icd10" | "mdm";
}

const kindStyle: Record<Highlight["kind"], string> = {
	// Same visual language as the Remix design's <mark> colors.
	cpt: "bg-[var(--info-bg)] text-[var(--info-fg)]",
	icd10: "bg-[var(--p-100)] text-[var(--p-700)]",
	mdm: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
};

// Find the first case-insensitive occurrence of `needle` inside
// `text` starting at `from`. Returns -1 when not found.
function indexOfCI(text: string, needle: string, from = 0): number {
	return text.toLowerCase().indexOf(needle.toLowerCase(), from);
}

// The agent's evidence spans are pulled verbatim from the note, but
// CMS/RPA PDFs often have whitespace/line-break noise that doesn't
// round-trip cleanly. We normalize both sides to a single-space form
// and search on that — then map the result back to the original text.
function normalize(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

interface Placed {
	start: number;
	end: number;
	kind: Highlight["kind"];
	code: string;
}

/**
 * Compute non-overlapping highlight placements greedily: walk the
 * highlights in order, skip ones whose span we've already placed or
 * that collide with an earlier placement.
 */
function placeHighlights(noteText: string, highlights: Highlight[]): Placed[] {
	const normNote = normalize(noteText);
	// Build a char-by-char map: for each position in the normalized
	// string, which position in the original does it correspond to?
	const normToOrig: number[] = [];
	let lastWasSpace = false;
	for (let i = 0; i < noteText.length; i++) {
		const ch = noteText[i];
		if (/\s/.test(ch)) {
			if (!lastWasSpace && normToOrig.length > 0) {
				normToOrig.push(i);
				lastWasSpace = true;
			}
		} else {
			normToOrig.push(i);
			lastWasSpace = false;
		}
	}
	// Trim trailing space if any
	if (lastWasSpace) normToOrig.pop();

	const placed: Placed[] = [];
	const occupied: Array<[number, number]> = [];

	for (const h of highlights) {
		const needle = normalize(h.span);
		if (!needle) continue;
		let pos = 0;
		let found = -1;
		while (pos < normNote.length) {
			const at = indexOfCI(normNote, needle, pos);
			if (at === -1) break;
			const origStart = normToOrig[at] ?? -1;
			const origEnd = normToOrig[at + needle.length - 1] ?? -1;
			if (origStart === -1 || origEnd === -1) break;
			const clash = occupied.some(
				([s, e]) => !(origEnd < s || origStart > e),
			);
			if (!clash) {
				found = origStart;
				occupied.push([origStart, origEnd]);
				placed.push({
					start: origStart,
					end: origEnd + 1,
					kind: h.kind,
					code: h.code,
				});
				break;
			}
			pos = at + 1;
		}
		if (found === -1) {
			// Span didn't match — skip silently. The code card will still
			// show the evidence text as a fallback quote.
		}
	}

	placed.sort((a, b) => a.start - b.start);
	return placed;
}

/**
 * Renders a clinical note with inline <mark>-style highlights for
 * every evidence span, each linked to the code it supports. Click a
 * highlight to fire the onCodeClick callback.
 */
export function NoteWithHighlights({
	noteText,
	highlights,
	onCodeClick,
	selectedCode,
	className,
}: {
	noteText: string;
	highlights: Highlight[];
	onCodeClick?: (code: string) => void;
	selectedCode?: string | null;
	className?: string;
}) {
	const placed = useMemo(
		() => placeHighlights(noteText, highlights),
		[noteText, highlights],
	);

	const nodes: ReactNode[] = [];
	let cursor = 0;
	placed.forEach((p, i) => {
		if (p.start > cursor) {
			nodes.push(noteText.slice(cursor, p.start));
		}
		const text = noteText.slice(p.start, p.end);
		const isSelected = selectedCode && p.code === selectedCode;
		nodes.push(
			<mark
				key={`h-${i}`}
				className={cls(
					"rounded px-0.5 cursor-pointer transition",
					kindStyle[p.kind],
					isSelected && "ring-2 ring-p-500 ring-offset-1",
					onCodeClick && "hover:brightness-95",
				)}
				onClick={() => onCodeClick?.(p.code)}
				title={`Evidence for ${p.code}`}
			>
				{text}
			</mark>,
		);
		cursor = p.end;
	});
	if (cursor < noteText.length) {
		nodes.push(noteText.slice(cursor));
	}

	return (
		<div
			className={cls(
				"font-serif text-[14px] leading-[1.75] text-n-800 whitespace-pre-wrap",
				className,
			)}
		>
			{nodes}
		</div>
	);
}
