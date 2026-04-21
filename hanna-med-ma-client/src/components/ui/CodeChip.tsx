import { cls } from "../../lib/cls";

type Tone = "primary" | "neutral" | "dnr";

// Design tokens for the primary text color don't swap in dark mode
// (only --p-50/100/200 do), so the dark-text-on-dark-bg pair is
// unreadable in .dark. Force white text in dark mode for primary.
const toneMap: Record<Tone, string> = {
	primary:
		"bg-[var(--p-100)] text-[var(--p-700)] border-[var(--p-300)] dark:text-white dark:border-[var(--p-200)]",
	neutral: "bg-[var(--n-100)] text-[var(--n-800)] border-[var(--n-200)]",
	dnr: "bg-[var(--dnr-bg)] text-[var(--dnr-fg)] border-[var(--dnr-fg)]/30",
};

/**
 * Compact pill for a CPT/HCPCS or ICD-10 code. Modifier renders
 * hanging off the right separated by a vertical bar, matching the
 * Remix design for the Encounter Review panel.
 */
export function CodeChip({
	code,
	modifier,
	tone = "primary",
	onClick,
	className,
}: {
	code: string;
	modifier?: string | string[] | null;
	tone?: Tone;
	onClick?: () => void;
	className?: string;
}) {
	const mods = Array.isArray(modifier)
		? modifier.filter(Boolean)
		: modifier
			? [modifier]
			: [];
	const Wrapper = onClick ? "button" : "span";
	return (
		<Wrapper
			onClick={onClick}
			className={cls(
				"inline-flex items-stretch h-7 rounded-md border font-mono text-[11.5px] overflow-hidden",
				toneMap[tone],
				onClick && "hover:brightness-95 transition cursor-pointer",
				className,
			)}
		>
			<span className="inline-flex items-center px-2 font-semibold tabular-nums">
				{code}
			</span>
			{mods.length > 0 && (
				<span
					className={cls(
						"inline-flex items-center px-1.5 border-l gap-0.5",
						tone === "primary" && "border-[var(--p-300)] bg-[var(--p-50)]",
						tone === "neutral" && "border-[var(--n-200)] bg-[var(--n-50)]",
						tone === "dnr" &&
							"border-[var(--dnr-fg)]/30 bg-[var(--dnr-bg)]/70",
					)}
				>
					{mods.map((m, i) => (
						<span key={i} className="tabular-nums">
							{m}
						</span>
					))}
				</span>
			)}
		</Wrapper>
	);
}
