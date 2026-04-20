import type { ReactNode } from "react";
import { cls } from "../../lib/cls";

type Tone =
	| "neutral"
	| "primary"
	| "ok"
	| "warn"
	| "dnr"
	| "info"
	| "outline";

const toneMap: Record<Tone, string> = {
	neutral: "bg-n-100 text-n-700",
	primary: "bg-p-100 text-p-700",
	ok: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
	warn: "bg-[var(--warn-bg)] text-[var(--warn-fg)]",
	dnr: "bg-[var(--dnr-bg)] text-[var(--dnr-fg)]",
	info: "bg-[var(--info-bg)] text-[var(--info-fg)]",
	outline: "border border-n-200 text-n-700",
};

export function Chip({
	tone = "neutral",
	mono = true,
	children,
	className,
}: {
	tone?: Tone;
	mono?: boolean;
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cls(
				"inline-flex items-center gap-1.5 px-2 py-[3px] rounded text-[10.5px] uppercase tracking-wider",
				mono && "font-mono",
				toneMap[tone],
				className,
			)}
		>
			{children}
		</span>
	);
}
