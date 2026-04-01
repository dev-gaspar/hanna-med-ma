import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { formatForDisplay } from "../../core/date.util";
import { SubAgentsService } from "../agents/sub-agents.service";

/** Hospital display labels */
const HOSPITAL_LABELS: Record<string, string> = {
	JACKSON: "Jackson Health",
	STEWARD: "Steward Health",
	BAPTIST: "Baptist Health",
};

@Injectable()
export class PatientSeenTool {
	private readonly logger = new Logger(PatientSeenTool.name);

	constructor(
		private prisma: PrismaService,
		private subAgents: SubAgentsService,
	) {}

	async execute(
		args: { hospital_types?: string[]; specific_question?: string },
		doctorContext: { doctorId: number; doctorName: string },
		callbacks?: { onStreaming?: (chunk: string) => void },
	): Promise<string> {
		const { hospital_types, specific_question } = args;

		// Query encounters for this doctor, including patient data
		const whereClause: any = {
			doctorId: doctorContext.doctorId,
		};

		if (hospital_types && hospital_types.length > 0) {
			whereClause.patient = { emrSystem: { in: hospital_types } };
		}

		const encounters = await this.prisma.encounter.findMany({
			where: whereClause,
			include: { patient: true },
			orderBy: { updatedAt: "desc" },
		});

		const filterText =
			hospital_types && hospital_types.length > 0
				? hospital_types.join(", ")
				: "all systems";

		if (encounters.length === 0) {
			const emptyMsg = `No seen patients found in ${filterText} for Dr. ${doctorContext.doctorName}.`;
			return JSON.stringify({
				count: 0,
				patients: [],
				message: emptyMsg,
			});
		}

		const mostRecentUpdate = encounters.reduce((latest, e) => {
			return e.updatedAt > latest ? e.updatedAt : latest;
		}, encounters[0].updatedAt);

		const lastUpdated = formatForDisplay(mostRecentUpdate);

		// If the doctor asks a specific question, delegate to conversational sub-agent
		if (specific_question) {
			const patientsJson = JSON.stringify(
				encounters.map((e) => ({
					name: e.patient.name,
					emrSystem: e.patient.emrSystem,
					encounterType: e.type,
					billingEmrStatus: e.patient.billingEmrStatus || null,
					billingEmrPatientId: e.patient.billingEmrPatientId || null,
					dateOfService: formatForDisplay(e.dateOfService),
					updatedAt: formatForDisplay(e.updatedAt),
				})),
			);
			return this.subAgents.formatSeenPatientList(
				patientsJson,
				{ hospitalType: filterText, lastUpdated },
				specific_question,
				callbacks?.onStreaming,
			);
		}

		// Build structured JSON grouped by emrSystem
		const grouped = new Map<string, typeof encounters>();
		for (const e of encounters) {
			const key = e.patient.emrSystem || "OTHER";
			if (!grouped.has(key)) grouped.set(key, []);
			grouped.get(key)!.push(e);
		}

		const sections = Array.from(grouped.entries()).map(([system, group]) => ({
			header: `🏥 ${HOSPITAL_LABELS[system] || system}`,
			patients: group.map((e) => ({
				id: e.patient.id,
				name: e.patient.name,
				billingEmrStatus: e.patient.billingEmrStatus || null,
				billingEmrPatientId: e.patient.billingEmrPatientId || null,
				seenAt: formatForDisplay(e.dateOfService),
			})),
		}));

		const result = JSON.stringify({
			sections,
			count: encounters.length,
			lastUpdated,
			isSeen: true,
		});

		callbacks?.onStreaming?.(result);
		return result;
	}
}
