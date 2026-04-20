import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cls } from "../../lib/cls";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	/** If true, renders with a subtle border (used on light surfaces where contrast is low). */
	outlined?: boolean;
}

/**
 * Uniform icon-only button used across the app (theme toggle, logout,
 * toolbar actions). Always `w-8 h-8` and matches neutral token system.
 */
export function IconButton({
	children,
	className,
	outlined = false,
	...rest
}: IconButtonProps) {
	return (
		<button
			{...rest}
			className={cls(
				"inline-flex items-center justify-center w-8 h-8 rounded-md text-n-500 hover:text-n-900 hover:bg-n-100 transition",
				"focus:outline-none focus-visible:ring-2 focus-visible:ring-p-400 focus-visible:ring-offset-1 focus-visible:ring-offset-n-0",
				outlined && "border border-n-200 bg-n-0",
				className,
			)}
		>
			{children}
		</button>
	);
}
