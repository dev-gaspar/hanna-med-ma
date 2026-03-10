import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { formatDateForDisplay } from "../../core/date-format.util";
import { SubAgentsService } from "../agents/sub-agents.service";

@Injectable()
export class PatientSummaryTool {
  private readonly logger = new Logger(PatientSummaryTool.name);

  constructor(
    private prisma: PrismaService,
    private subAgents: SubAgentsService,
  ) {}

  async execute(
    args: {
      hospital_type: string;
      patient_name: string;
      specific_question?: string;
    },
    doctorContext: { doctorId: number; doctorSpecialty: string },
    callbacks?: { onStreaming?: (chunk: string) => void },
  ): Promise<string> {
    const { hospital_type, patient_name, specific_question } = args;

    const normalizedName = patient_name
      .toLowerCase()
      .replace(/,/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const lastName = normalizedName.split(" ")[0];

    const patient = await this.prisma.patient.findFirst({
      where: {
        doctorId: doctorContext.doctorId,
        emrSystem: hospital_type as any,
        normalizedName: { contains: lastName },
        isActive: true,
      },
      include: {
        rawData: {
          where: { dataType: "SUMMARY" },
          orderBy: { extractedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!patient) {
      return JSON.stringify({
        error: true,
        message: `Patient "${patient_name}" not found in ${hospital_type}. Please verify the name.`,
      });
    }

    const rawData = patient.rawData[0];
    if (!rawData) {
      return `I apologize, Doctor. Found ${patient.name} in ${hospital_type}, but no clinical summary is available yet.`;
    }

    // Direct LLM Sub-Agent formatter
    return this.subAgents.formatSummary(
      rawData.rawContent,
      {
        patientName: patient.name,
        hospitalType: hospital_type,
        extractedAt: formatDateForDisplay(rawData.extractedAt),
        doctorSpecialty: doctorContext.doctorSpecialty,
      },
      specific_question,
      callbacks?.onStreaming,
    );
  }
}

@Injectable()
export class BatchPatientSummaryTool {
  private readonly logger = new Logger(BatchPatientSummaryTool.name);

  constructor(private summaryTool: PatientSummaryTool) {}

  async execute(
    args: {
      hospital_type: string;
      patient_names: string[];
      specific_question?: string;
    },
    doctorContext: { doctorId: number; doctorSpecialty: string },
    callbacks?: { onStreaming?: (chunk: string) => void },
  ): Promise<string> {
    const results: string[] = [];
    for (let i = 0; i < args.patient_names.length; i++) {
        if (i > 0 && callbacks?.onStreaming) {
            callbacks.onStreaming("\\n\\n---\\n\\n");
        }
        const name = args.patient_names[i];
        const res = await this.summaryTool.execute(
            { hospital_type: args.hospital_type, patient_name: name, specific_question: args.specific_question },
            doctorContext,
            callbacks
        );
        results.push(res);
    }
    return results.join("\\n\\n---\\n\\n");
  }
}
