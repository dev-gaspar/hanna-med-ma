import { useMemo } from "react";
import { PatientCard } from "./PatientCard";
import { parseInlineFormatting } from "../../lib/chatUtils";
import type { SelectedItem } from "./DoctorChat";

export interface PatientItem {
	id: number;
	name: string;
	reason?: string | null;
	location?: string | null;
	admittedDate?: string | null;
	isNew?: boolean;
	// Seen list fields
	billingEmrStatus?: string | null;
	billingEmrPatientId?: string | null;
	seenAt?: string | null;
}

interface PatientSection {
	header: string;
	patients: PatientItem[];
}

interface PatientListData {
	sections: PatientSection[];
	count: number;
	lastUpdated: string;
	isSeen?: boolean;
}

interface PatientListMessageProps {
	content: string;
	selection: {
		selectedId?: string | number;
		onSelect: (item: SelectedItem | null) => void;
	};
	onAction?: (
		action: "summary" | "insurance" | "lab",
		patientName: string,
	) => void;
	onMarkSeen?: (patientId: number, encounterType: "CONSULT" | "PROGRESS") => void;
	seenPatients?: Set<number>;
	markingLoading?: Set<number>;
}

/**
 * Build the box-drawing text for a single patient (used for copy).
 */
export function formatPatientText(p: PatientItem, isSeen?: boolean): string {
	const lines: string[] = [];
	const nameDisplay = p.isNew ? `*${p.name} (NEW)*` : p.name;
	lines.push(nameDisplay);

	if (isSeen) {
		const details: string[] = [];
		if (p.billingEmrStatus) details.push(`├ EMR Status: ${p.billingEmrStatus}`);
		if (p.billingEmrPatientId) details.push(`├ EMR ID: ${p.billingEmrPatientId}`);
		if (p.seenAt) details.push(`└ Marked Seen: ${p.seenAt}`);
		// Change last ├ to └ if needed
		if (details.length > 0) {
			details[details.length - 1] = details[details.length - 1].replace("├", "└");
		}
		lines.push(...details);
	} else {
		const details: string[] = [];
		if (p.reason) details.push(`├ Reason: ${p.reason}`);
		if (p.location) details.push(`├ Location: ${p.location}`);
		if (p.admittedDate) details.push(`├ Admitted: ${p.admittedDate}`);
		if (details.length > 0) {
			details[details.length - 1] = details[details.length - 1].replace("├", "└");
		}
		lines.push(...details);
	}

	return lines.join("\n");
}

/**
 * Build the full message text (used for copy).
 */
export function formatFullListText(data: PatientListData): string {
	const parts: string[] = [];

	for (const section of data.sections) {
		parts.push(section.header);
		parts.push("");
		for (const p of section.patients) {
			parts.push(formatPatientText(p, data.isSeen));
			parts.push("");
		}
	}

	const label = data.isSeen ? "seen patients" : "patients";
	parts.push(`_${data.count} ${label} — Updated at: ${data.lastUpdated}_`);
	return parts.join("\n");
}

function parseContent(content: string): PatientListData | null {
	try {
		const parsed = JSON.parse(content.trim());
		if (parsed.sections && Array.isArray(parsed.sections)) {
			return parsed as PatientListData;
		}
	} catch {
		// Not JSON
	}
	return null;
}

export const PatientListMessage = ({
	content,
	selection,
	onAction,
	onMarkSeen,
	seenPatients,
	markingLoading,
}: PatientListMessageProps) => {
	const data = useMemo(() => parseContent(content), [content]);

	// Fallback: if content is not valid JSON (legacy messages), render as plain text
	if (!data) {
		return (
			<div className="text-[13px] leading-relaxed tracking-wide whitespace-pre-wrap">
				{parseInlineFormatting(content)}
			</div>
		);
	}

	let patientIdx = 0;

	return (
		<div className="space-y-1 py-1">
			{data.sections.map((section, si) => (
				<div key={`s-${si}`}>
					<div className="text-[13px] font-bold text-slate-800 dark:text-white px-2.5 pt-3 pb-1">
						{parseInlineFormatting(section.header)}
					</div>
					{section.patients.map((patient) => {
						const idx = patientIdx++;
						return (
							<PatientCard
								key={`p-${patient.id}`}
								patient={patient}
								isSeen={!!data.isSeen}
								selection={selection}
								index={idx}
								onAction={onAction}
								onMarkSeen={onMarkSeen}
								isMarkedSeen={seenPatients?.has(patient.id)}
								isMarkingLoading={markingLoading?.has(patient.id)}
							/>
						);
					})}
				</div>
			))}
			<div className="text-[11px] text-slate-500 dark:text-slate-400 px-2.5 pt-2">
				{parseInlineFormatting(
					`_${data.count} ${data.isSeen ? "seen patients" : "patients"} — Updated at: ${data.lastUpdated}_`,
				)}
			</div>
		</div>
	);
};
