import { PatientCard } from "./PatientCard";
import { parseInlineFormatting } from "../../lib/chatUtils";
import type { SelectedItem } from "./DoctorChat";

interface PatientListMessageProps {
	content: string;
	selection: {
		selectedId?: string | number;
		onSelect: (item: SelectedItem | null) => void;
	};
	onAction?: (action: "summary" | "insurance", patientName: string) => void;
}

type ListItem =
	| { kind: "header"; text: string }
	| { kind: "patient"; text: string }
	| { kind: "footer"; text: string };

export const PatientListMessage = ({
	content,
	selection,
	onAction,
}: PatientListMessageProps) => {
	const lines = content.split("\n").filter((l) => l.trim() !== "");

	const items: ListItem[] = [];
	let patientBuf: string[] = [];

	const flushPatient = () => {
		if (patientBuf.length > 0) {
			items.push({ kind: "patient", text: patientBuf.join("\n") });
			patientBuf = [];
		}
	};

	for (const line of lines) {
		const t = line.trim();
		const isDetail = t.startsWith("├") || t.startsWith("└") || t.startsWith("│");

		if (t.startsWith("🏥")) {
			flushPatient();
			items.push({ kind: "header", text: line });
		} else if (/active patients/i.test(t) || /^\d+ patients?$/i.test(t)) {
			flushPatient();
			items.push({ kind: "footer", text: line });
		} else if (isDetail) {
			patientBuf.push(line);
		} else {
			flushPatient();
			patientBuf.push(line);
		}
	}
	flushPatient();

	let patientIdx = 0;

	return (
		<div className="space-y-1 py-1">
			{items.map((item, i) => {
				if (item.kind === "header") {
					return (
						<div
							key={`h-${i}`}
							className="text-[13px] font-bold text-slate-800 dark:text-white px-2.5 pt-3 pb-1"
						>
							{parseInlineFormatting(item.text)}
						</div>
					);
				}
				if (item.kind === "footer") {
					return (
						<div
							key={`f-${i}`}
							className="text-[11px] text-slate-500 dark:text-slate-400 px-2.5 pt-2"
						>
							{parseInlineFormatting(item.text)}
						</div>
					);
				}
				const idx = patientIdx++;
				return (
					<PatientCard
						key={`p-${idx}`}
						content={item.text}
						selection={selection}
						index={idx}
						onAction={onAction}
					/>
				);
			})}
		</div>
	);
};
