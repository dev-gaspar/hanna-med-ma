import { X } from "lucide-react";
import { type ReactNode } from "react";

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
}

export default function Modal({
	isOpen,
	onClose,
	title,
	children,
}: ModalProps) {
	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="fixed inset-0 bg-black/50" onClick={onClose}></div>
			<div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto m-4">
				<div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
					<h2 className="text-lg font-bold text-gray-900 dark:text-white">
						{title}
					</h2>
					<button
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
				<div className="p-4">{children}</div>
			</div>
		</div>
	);
}
