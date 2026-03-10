import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { formatDateForDisplay } from "../../core/date-format.util";
import { SubAgentsService } from "../agents/sub-agents.service";

@Injectable()
export class PatientListTool {
  private readonly logger = new Logger(PatientListTool.name);

  constructor(
    private prisma: PrismaService,
    private subAgents: SubAgentsService,
  ) {}

  async execute(
    args: { hospital_type: string; specific_question?: string },
    doctorContext: { doctorId: number; doctorName: string },
    callbacks?: { onStreaming?: (chunk: string) => void },
  ): Promise<string> {
    const { hospital_type, specific_question } = args;

    const patients = await this.prisma.patient.findMany({
      where: {
        doctorId: doctorContext.doctorId,
        emrSystem: hospital_type as any,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    if (patients.length === 0) {
      return JSON.stringify({
        hospital: hospital_type,
        count: 0,
        patients: [],
        message: `No active patients found in ${hospital_type} for Dr. ${doctorContext.doctorName}.`,
      });
    }

    const mostRecentUpdate = patients.reduce((latest, p) => {
      const ts = p.lastSeenAt || p.updatedAt;
      return ts > latest ? ts : latest;
    }, patients[0].lastSeenAt || patients[0].updatedAt);

    const patientsJson = JSON.stringify(
      patients.map((p) => ({
        name: p.name,
        location: p.location || null,
        ...(p.facility && { facility: p.facility }),
        reason: p.reason || null,
        admittedDate: p.admittedDate || null,
      })),
    );

    return this.subAgents.formatPatientList(
      patientsJson,
      {
        hospitalType: hospital_type,
        lastUpdated: formatDateForDisplay(mostRecentUpdate),
      },
      specific_question,
      callbacks?.onStreaming,
    );
  }
}

@Injectable()
export class BatchPatientListTool {
  private readonly logger = new Logger(BatchPatientListTool.name);

  constructor(private patientListTool: PatientListTool) {}

  async execute(
    args: { hospital_types: string[]; specific_question?: string },
    doctorContext: { doctorId: number; doctorName: string },
    callbacks?: { onStreaming?: (chunk: string) => void }
  ): Promise<string> {
    const results: string[] = [];
    for (let i = 0; i < args.hospital_types.length; i++) {
        if (i > 0 && callbacks?.onStreaming) {
            callbacks.onStreaming("\n\n---\n\n");
        }
        const type = args.hospital_types[i];
        const res = await this.patientListTool.execute(
            { hospital_type: type, specific_question: args.specific_question },
            doctorContext,
            callbacks
        );
        results.push(res);
    }
    return results.join("\n\n---\n\n");
  }
}
