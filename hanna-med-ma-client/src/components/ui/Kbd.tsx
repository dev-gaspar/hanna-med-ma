import type { ReactNode } from "react";
import { cls } from "../../lib/cls";

export function Kbd({
	children,
	dark = false,
}: {
	children: ReactNode;
	dark?: boolean;
}) {
	return (
		<kbd
			className={cls(
				"inline-flex items-center justify-center px-1.5 py-[1px] rounded-[3px] font-mono text-[10px] leading-none border-b-2",
				dark
					? "bg-white/10 border-white/20 text-white/90"
					: "bg-n-0 border-n-200 text-n-700",
			)}
		>
			{children}
		</kbd>
	);
}
