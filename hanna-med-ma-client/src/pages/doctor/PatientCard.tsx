import { parseInlineFormatting } from "../../lib/chatUtils";
import { FileText, Landmark } from "lucide-react";
import type { SelectedItem } from "./DoctorChat";

interface PatientCardProps {
	content: string;
	index: number;
	selection: {
		selectedId?: string | number;
		onSelect: (item: SelectedItem | null) => void;
	};
	onAction?: (action: "summary" | "insurance", patientName: string) => void;
}

export const PatientCard = ({
	content,
	index,
	selection,
	onAction,
}: PatientCardProps) => {
	const lines = content.split("\n").filter((l: string) => l.trim());
	const firstLine = lines[0] || "";
	const remainingLines = lines.slice(1);
	const patientName = firstLine.trim();
	const selectionId = `patient-${patientName}-${index}`;
	const isSelected = selection.selectedId === selectionId;

	const handleClick = (e: React.MouseEvent) => {
		if (window.innerWidth < 768) {
			e.stopPropagation();
			selection.onSelect({
				type: "patient",
				id: selectionId,
				content: content,
				patientName: patientName,
			});
			if ("vibrate" in navigator) navigator.vibrate(20);
		}
	};

	const actionBtnClass =
		"p-1 rounded-md transition-colors duration-150 flex items-center gap-1";

	return (
		<div
			onClick={handleClick}
			className={`group/card relative rounded-xl p-2.5 cursor-pointer select-none transition-all duration-200 ${
				isSelected
					? "ring-2 ring-indigo-500/50 dark:ring-indigo-400/50 bg-white dark:bg-slate-700 shadow-sm"
					: "md:hover:bg-white/60 md:dark:hover:bg-slate-800/60"
			}`}
		>
			<div className="flex items-center gap-1.5 mb-1">
				<span className="text-xs font-bold text-slate-800 dark:text-white truncate flex-1 min-w-0">
					{parseInlineFormatting(firstLine)}
				</span>

				<div className="shrink-0 hidden md:flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150">
					<button
						onClick={(e) => {
							e.stopPropagation();
							onAction?.("summary", patientName);
						}}
						className={`${actionBtnClass} text-slate-500 dark:text-slate-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30`}
					>
						<FileText className="w-4 h-4" />
						<span className="text-[10px] font-medium">Summary</span>
					</button>
					<button
						onClick={(e) => {
							e.stopPropagation();
							onAction?.("insurance", patientName);
						}}
						className={`${actionBtnClass} text-slate-500 dark:text-slate-300 hover:text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/30`}
					>
						<Landmark className="w-4 h-4" />
						<span className="text-[10px] font-medium">Insurance</span>
					</button>
				</div>
			</div>

			{remainingLines.map((line, i) => (
				<div
					key={i}
					className="text-[11px] text-slate-600 dark:text-slate-400 font-mono leading-snug"
				>
					{parseInlineFormatting(line)}
				</div>
			))}
		</div>
	);
};
