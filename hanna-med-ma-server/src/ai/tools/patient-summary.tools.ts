import { Injectable, Logger } from "@nestjs/common";
import { RawDataType } from "@prisma/client";
import { PrismaService } from "../../core/prisma.service";
import { formatForDisplay } from "../../core/date.util";
import { SubAgentsService } from "../agents/sub-agents.service";
import { normalizeName } from "../../core/patient-name.util";

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

    const lastName = normalizeName(patient_name).split(" ")[0];

    const patients = await this.prisma.patient.findMany({
      where: {
        doctorLinks: { some: { doctorId: doctorContext.doctorId, isActive: true } },
        emrSystem: hospital_type as any,
        normalizedName: { contains: lastName },
      },
      include: {
        rawData: {
          where: { dataType: RawDataType.SUMMARY },
          orderBy: { extractedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (patients.length === 0) {
      return JSON.stringify({
        error: true,
        message: `Patient "${patient_name}" not found in ${hospital_type}. Please verify the name.`,
      });
    }

    if (patients.length > 1) {
      const patientList = patients
        .map(
          (p) =>
            `- ${p.name} (Admitted: ${p.admittedDate || "Unknown"})`,
        )
        .join("\n");
      // Disable streaming since we are returning a system message to the LLM
      return `Multiple patients found matching "${patient_name}" in ${hospital_type}. Please ask the doctor to clarify which one they mean:\n${patientList}`;
    }

    const patient = patients[0];
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
        extractedAt: formatForDisplay(rawData.extractedAt),
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
        callbacks.onStreaming("\n\n---\n\n");
      }
      const name = args.patient_names[i];
      const res = await this.summaryTool.execute(
        {
          hospital_type: args.hospital_type,
          patient_name: name,
          specific_question: args.specific_question,
        },
        doctorContext,
        callbacks,
      );
      results.push(res);
    }
    return results.join("\n\n---\n\n");
  }
}
