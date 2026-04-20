import type { ReactNode } from "react";

export function EmptyState({
	title,
	body,
	action,
}: {
	title: string;
	body: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-start gap-2 p-6 border border-dashed border-n-200 rounded-lg bg-n-0">
			<div className="text-[14px] font-semibold text-n-900">{title}</div>
			<div className="text-[13px] text-n-600 max-w-sm leading-relaxed">
				{body}
			</div>
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}
