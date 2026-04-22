import { parseInlineFormatting } from "../../lib/markdown";
import { cls } from "../../lib/cls";
import {
	FileText,
	Shield,
	FlaskConical,
	CheckCircle2,
	Loader2,
} from "lucide-react";
import type { SelectedItem } from "./DoctorChat";
import type { PatientItem } from "./PatientListMessage";
import { formatPatientText } from "./PatientListMessage";
import { Chip } from "../../components/ui/Chip";

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

interface DetailLine {
	label: string;
	value: string;
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
	const selectionId = `patient-${patient.id}-${index}`;
	const isSelected = selection.selectedId === selectionId;

	const details: DetailLine[] = [];
	if (isSeen) {
		if (patient.billingEmrStatus)
			details.push({ label: "EMR status", value: patient.billingEmrStatus });
		if (patient.billingEmrPatientId)
			details.push({ label: "EMR id", value: patient.billingEmrPatientId });
		if (patient.seenAt)
			details.push({ label: "Marked seen", value: patient.seenAt });
	} else {
		if (patient.reason) details.push({ label: "Reason", value: patient.reason });
		if (patient.location)
			details.push({ label: "Location", value: patient.location });
		if (patient.admittedDate)
			details.push({ label: "Admitted", value: patient.admittedDate });
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
		"inline-flex items-center gap-1.5 h-7 px-2 rounded border border-n-200 bg-n-0 text-n-700 text-[11.5px] hover:bg-n-100 transition";

	return (
		<div
			onClick={handleClick}
			className={cls(
				"group/card relative rounded-lg px-3 py-2.5 cursor-pointer select-none transition-all border",
				isSelected
					? "bg-p-50 border-p-500"
					: "bg-n-0 border-n-150 md:hover:border-n-200 md:hover:bg-n-50",
			)}
		>
			<div className="flex items-start gap-2">
				<div
					className={cls(
						"w-1 self-stretch rounded-full mt-0.5",
						patient.isNew ? "bg-[var(--warn-fg)]" : "bg-transparent",
					)}
				/>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-0.5">
						<span className="text-[13.5px] font-semibold text-n-900 truncate flex-1 min-w-0">
							{parseInlineFormatting(patient.name)}
						</span>
						{patient.isNew && <Chip tone="warn">new</Chip>}
						{isSeen && <Chip tone="ok">seen</Chip>}
					</div>

					{details.length > 0 && (
						<div className="space-y-0.5 mt-1.5">
							{details.map((d, i) => (
								<div
									key={i}
									className="flex items-baseline gap-2 text-[11.5px] leading-snug"
								>
									<span className="label-kicker w-[72px] shrink-0">
										{d.label}
									</span>
									<span className="font-mono text-n-700 truncate">
										{parseInlineFormatting(d.value)}
									</span>
								</div>
							))}
						</div>
					)}

					<div className="hidden md:flex items-center gap-1.5 mt-2.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
						<button
							onClick={(e) => {
								e.stopPropagation();
								onAction?.("summary", patient.name);
							}}
							className={actionBtnClass}
						>
							<FileText className="w-3.5 h-3.5" />
							<span>Summary</span>
						</button>
						<button
							onClick={(e) => {
								e.stopPropagation();
								onAction?.("insurance", patient.name);
							}}
							className={actionBtnClass}
						>
							<Shield className="w-3.5 h-3.5" />
							<span>Insurance</span>
						</button>
						<button
							onClick={(e) => {
								e.stopPropagation();
								onAction?.("lab", patient.name);
							}}
							className={actionBtnClass}
						>
							<FlaskConical className="w-3.5 h-3.5" />
							<span>Lab</span>
						</button>
						{!isSeen && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onMarkSeen?.(patient.id);
								}}
								disabled={isMarkingLoading}
								className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-p-600 text-white text-[11.5px] hover:bg-p-700 disabled:opacity-40 transition"
							>
								{isMarkingLoading ? (
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
								) : (
									<CheckCircle2 className="w-3.5 h-3.5" />
								)}
								<span>Mark seen</span>
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};
