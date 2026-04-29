import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	/** Width preset. Defaults to "md" (max-w-md). Use "lg" or "xl"
	 *  when the form needs side-by-side fields or a long content
	 *  area such as a Markdown delta + a quick-pick grid. */
	size?: "md" | "lg" | "xl";
}

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
	md: "max-w-md",
	lg: "max-w-2xl",
	xl: "max-w-4xl",
};

export default function Modal({
	isOpen,
	onClose,
	title,
	children,
	size = "md",
}: ModalProps) {
	useEffect(() => {
		if (!isOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
			<div
				className="fixed inset-0 bg-n-900/40 backdrop-blur-[2px]"
				onClick={onClose}
			/>
			<div
				className={`relative bg-n-0 rounded-lg border border-n-200 shadow-deep w-full ${SIZE_CLASS[size]} max-h-[85vh] overflow-hidden flex flex-col`}
			>
				<div className="flex items-center justify-between px-5 h-12 border-b border-n-150 shrink-0">
					<h2 className="font-serif text-[17px] font-medium text-n-900">
						{title}
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="w-7 h-7 inline-flex items-center justify-center rounded-md text-n-500 hover:text-n-900 hover:bg-n-100 transition"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
				<div className="px-5 py-4 overflow-y-auto custom-scrollbar">
					{children}
				</div>
			</div>
		</div>
	);
}
