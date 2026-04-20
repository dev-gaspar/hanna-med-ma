import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cls } from "../../lib/cls";

type Tone = "primary" | "ghost" | "subtle" | "danger" | "ok" | "link";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	tone?: Tone;
	size?: Size;
	leading?: ReactNode;
	trailing?: ReactNode;
}

const sizeMap: Record<Size, string> = {
	sm: "h-7 px-2.5 text-[12px] gap-1.5",
	md: "h-9 px-3.5 text-[13px] gap-2",
	lg: "h-11 px-5 text-[14px] gap-2",
};

const toneMap: Record<Tone, string> = {
	primary:
		"bg-p-600 text-white hover:bg-p-700 disabled:opacity-40 disabled:cursor-not-allowed",
	ghost:
		"bg-transparent text-n-800 border border-n-200 hover:bg-n-100 disabled:opacity-40",
	subtle: "bg-n-100 text-n-800 hover:bg-n-150 disabled:opacity-40",
	danger:
		"bg-[var(--dnr-bg)] text-[var(--dnr-fg)] hover:brightness-95 disabled:opacity-40",
	ok: "bg-[var(--ok-bg)] text-[var(--ok-fg)] hover:brightness-95 disabled:opacity-40",
	link: "bg-transparent text-p-600 hover:text-p-700 hover:underline underline-offset-4 px-0 h-auto",
};

export function Button({
	tone = "primary",
	size = "md",
	leading,
	trailing,
	className,
	children,
	...rest
}: ButtonProps) {
	return (
		<button
			{...rest}
			className={cls(
				"inline-flex items-center justify-center rounded-md font-medium transition whitespace-nowrap",
				"focus:outline-none focus-visible:ring-2 focus-visible:ring-p-400 focus-visible:ring-offset-1 focus-visible:ring-offset-n-0",
				tone !== "link" && sizeMap[size],
				toneMap[tone],
				className,
			)}
		>
			{leading}
			{children}
			{trailing}
		</button>
	);
}
