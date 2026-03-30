import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { formatDateForDisplay } from "../../core/date-format.util";
import { SubAgentsService } from "../agents/sub-agents.service";

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

		const whereClause: any = {
			doctorId: doctorContext.doctorId,
			isSeen: true,
		};

		if (hospital_types && hospital_types.length > 0) {
			whereClause.emrSystem = { in: hospital_types };
		}

		const patients = await this.prisma.patient.findMany({
			where: whereClause,
			orderBy: { updatedAt: "desc" },
		});

		const filterText =
			hospital_types && hospital_types.length > 0
				? hospital_types.join(", ")
				: "all systems";

		if (patients.length === 0) {
			const emptyMsg = `No seen patients found in ${filterText} for Dr. ${doctorContext.doctorName}.`;
			return JSON.stringify({
				count: 0,
				patients: [],
				message: emptyMsg,
			});
		}

		const mostRecentUpdate = patients.reduce((latest, p) => {
			return p.updatedAt > latest ? p.updatedAt : latest;
		}, patients[0].updatedAt);

		const patientsJson = JSON.stringify(
			patients.map((p) => ({
				name: p.name,
				emrSystem: p.emrSystem,
				billingEmrStatus: p.billingEmrStatus || null,
				billingEmrPatientId: p.billingEmrPatientId || null,
				updatedAt: formatDateForDisplay(p.updatedAt),
			})),
		);

		return this.subAgents.formatSeenPatientList(
			patientsJson,
			{
				hospitalType: filterText,
				lastUpdated: formatDateForDisplay(mostRecentUpdate),
			},
			specific_question,
			callbacks?.onStreaming,
		);
	}
}
