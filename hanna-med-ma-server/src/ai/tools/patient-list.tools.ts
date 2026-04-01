import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { formatForDisplay, isWithinLast24Hours } from "../../core/date.util";
import { SubAgentsService } from "../agents/sub-agents.service";

/** Hospital display labels used for group headers */
const HOSPITAL_LABELS: Record<string, string> = {
  JACKSON: "Jackson Health",
  STEWARD: "Steward Health",
  BAPTIST: "Baptist Health",
};

function isNewPatient(admittedDate: string | null): boolean {
  if (!admittedDate) return false;
  return isWithinLast24Hours(admittedDate);
}

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

    // Query patients linked to this doctor via DoctorPatient join
    const patients = await this.prisma.patient.findMany({
      where: {
        emrSystem: hospital_type as any,
        doctorLinks: {
          some: { doctorId: doctorContext.doctorId, isActive: true },
        },
      },
      include: {
        doctorLinks: {
          where: { doctorId: doctorContext.doctorId },
          select: { lastSeenAt: true },
          take: 1,
        },
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
      const ts = p.doctorLinks[0]?.lastSeenAt || p.updatedAt;
      return ts > latest ? ts : latest;
    }, patients[0].doctorLinks[0]?.lastSeenAt || patients[0].updatedAt);

    const lastUpdated = formatForDisplay(mostRecentUpdate);

    // If the doctor asks a specific question, delegate to conversational sub-agent
    if (specific_question) {
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
        { hospitalType: hospital_type, lastUpdated },
        specific_question,
        callbacks?.onStreaming,
      );
    }

    // Build structured JSON grouped by facility
    const grouped = new Map<string, typeof patients>();
    for (const p of patients) {
      const key = p.facility || HOSPITAL_LABELS[hospital_type] || hospital_type;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    const sections = Array.from(grouped.entries()).map(([label, group]) => ({
      header: `🏥 ${label}`,
      patients: group.map((p) => ({
        id: p.id,
        name: p.name,
        reason: p.reason || null,
        location: p.location || null,
        admittedDate: p.admittedDate || null,
        isNew: isNewPatient(p.admittedDate),
      })),
    }));

    const result = JSON.stringify({
      sections,
      count: patients.length,
      lastUpdated,
    });

    // Stream the JSON so the router agent mutes its own output
    callbacks?.onStreaming?.(result);
    return result;
  }
}

@Injectable()
export class BatchPatientListTool {
  private readonly logger = new Logger(BatchPatientListTool.name);

  constructor(private patientListTool: PatientListTool) {}

  async execute(
    args: { hospital_types: string[]; specific_question?: string },
    doctorContext: { doctorId: number; doctorName: string },
    callbacks?: { onStreaming?: (chunk: string) => void },
  ): Promise<string> {
    const allSections: any[] = [];
    let totalCount = 0;
    let lastUpdated = "";

    for (const type of args.hospital_types) {
      const raw = await this.patientListTool.execute(
        { hospital_type: type, specific_question: args.specific_question },
        doctorContext,
        // Don't let individual tools stream — we'll stream the combined result
      );

      // If it was a specific_question (conversational text), just concatenate
      if (args.specific_question) {
        // Conversational responses are plain text
        if (allSections.length > 0) allSections.push("---");
        allSections.push(raw);
        continue;
      }

      try {
        const parsed = JSON.parse(raw);
        if (parsed.sections) {
          allSections.push(...parsed.sections);
          totalCount += parsed.count || 0;
          if (parsed.lastUpdated) lastUpdated = parsed.lastUpdated;
        }
      } catch {
        allSections.push(raw);
      }
    }

    // If specific_question, return concatenated text
    if (args.specific_question) {
      const text = allSections.join("\n\n");
      callbacks?.onStreaming?.(text);
      return text;
    }

    const result = JSON.stringify({
      sections: allSections,
      count: totalCount,
      lastUpdated,
    });

    callbacks?.onStreaming?.(result);
    return result;
  }
}
