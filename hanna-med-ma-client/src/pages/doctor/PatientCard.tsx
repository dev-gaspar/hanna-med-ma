import { parseInlineFormatting } from "../../lib/chatUtils";
import { FileText, Landmark, FlaskConical, CheckCircle2, Loader2 } from "lucide-react";
import type { SelectedItem } from "./DoctorChat";
import type { PatientItem } from "./PatientListMessage";
import { formatPatientText } from "./PatientListMessage";

interface PatientCardProps {
	patient: PatientItem;
	isSeen: boolean;
	index: number;
	selection: {
		selectedId?: string | number;
		onSelect: (item: SelectedItem | null) => void;
	};
	onAction?: (
		action: "summary" | "insurance" | "lab",
		patientName: string,
	) => void;
	onMarkSeen?: (patientId: number) => void;
	isMarkingLoading?: boolean;
}

export const PatientCard = ({
	patient,
	isSeen,
	index,
	selection,
	onAction,
	onMarkSeen,
	isMarkingLoading,
}: PatientCardProps) => {
	const nameDisplay = patient.isNew ? `*${patient.name} (NEW)*` : patient.name;
	const selectionId = `patient-${patient.id}-${index}`;
	const isSelected = selection.selectedId === selectionId;

	// Build detail lines from structured data
	const detailLines: string[] = [];
	if (isSeen) {
		if (patient.billingEmrStatus) detailLines.push(`├ EMR Status: ${patient.billingEmrStatus}`);
		if (patient.billingEmrPatientId) detailLines.push(`├ EMR ID: ${patient.billingEmrPatientId}`);
		if (patient.seenAt) detailLines.push(`├ Marked Seen: ${patient.seenAt}`);
	} else {
		if (patient.reason) detailLines.push(`├ Reason: ${patient.reason}`);
		if (patient.location) detailLines.push(`├ Location: ${patient.location}`);
		if (patient.admittedDate) detailLines.push(`├ Admitted: ${patient.admittedDate}`);
	}
	// Replace last ├ with └
	if (detailLines.length > 0) {
		detailLines[detailLines.length - 1] = detailLines[detailLines.length - 1].replace("├", "└");
	}

	const copyText = formatPatientText(patient, isSeen);

	const handleClick = (e: React.MouseEvent) => {
		if (window.innerWidth < 768) {
			e.stopPropagation();
			selection.onSelect({
				type: "patient",
				id: selectionId,
				content: copyText,
				patientName: patient.name,
				patientId: patient.id,
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
					{parseInlineFormatting(nameDisplay)}
				</span>

				<div className="shrink-0 hidden md:flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150">
					<button
						onClick={(e) => {
							e.stopPropagation();
							onAction?.("summary", patient.name);
						}}
						className={`${actionBtnClass} text-slate-500 dark:text-slate-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30`}
					>
						<FileText className="w-4 h-4" />
						<span className="text-[10px] font-medium">Summary</span>
					</button>
					<button
						onClick={(e) => {
							e.stopPropagation();
							onAction?.("insurance", patient.name);
						}}
						className={`${actionBtnClass} text-slate-500 dark:text-slate-300 hover:text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/30`}
					>
						<Landmark className="w-4 h-4" />
						<span className="text-[10px] font-medium">Insurance</span>
					</button>
					<button
						onClick={(e) => {
							e.stopPropagation();
							onAction?.("lab", patient.name);
						}}
						className={`${actionBtnClass} text-slate-500 dark:text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30`}
					>
						<FlaskConical className="w-4 h-4" />
						<span className="text-[10px] font-medium">Lab</span>
					</button>

					<div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

					<button
						onClick={(e) => {
							e.stopPropagation();
							onMarkSeen?.(patient.id);
						}}
						disabled={isMarkingLoading}
						className={`${actionBtnClass} text-slate-500 dark:text-slate-300 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30`}
						title="Seen"
					>
						{isMarkingLoading ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<CheckCircle2 className="w-4 h-4" />
						)}
						<span className="text-[10px] font-medium">
							Seen
						</span>
					</button>
				</div>
			</div>

			{detailLines.map((line, i) => (
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
