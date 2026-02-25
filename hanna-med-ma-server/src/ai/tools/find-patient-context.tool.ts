import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";

@Injectable()
export class FindPatientContextTool {
  private readonly logger = new Logger(FindPatientContextTool.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Locate patients across hospitals.
   * Mode A: Specific names → returns hospital mapping.
   * Mode B: ["ALL_PATIENTS"] → returns all active patients grouped by hospital.
   */
  async execute(
    args: { patient_names: string[] },
    doctorContext: { doctorId: number },
  ): Promise<string> {
    const { patient_names } = args;

    if (patient_names.length === 1 && patient_names[0] === "ALL_PATIENTS") {
      return this.discoverAll(doctorContext.doctorId);
    }

    return this.locatePatients(doctorContext.doctorId, patient_names);
  }

  private async discoverAll(doctorId: number): Promise<string> {
    const patients = await this.prisma.patient.findMany({
      where: { doctorId, isActive: true },
      orderBy: [{ emrSystem: "asc" }, { name: "asc" }],
    });

    const grouped: Record<string, string[]> = {};
    for (const p of patients) {
      const system = p.emrSystem;
      if (!grouped[system]) grouped[system] = [];
      grouped[system].push(p.name);
    }

    return JSON.stringify(grouped);
  }

  private async locatePatients(
    doctorId: number,
    names: string[],
  ): Promise<string> {
    const result: Record<string, string[]> = {};

    for (const name of names) {
      const normalized = name
        .toLowerCase()
        .replace(/,/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const lastName = normalized.split(" ")[0];

      const matches = await this.prisma.patient.findMany({
        where: {
          doctorId,
          isActive: true,
          normalizedName: { contains: lastName },
        },
      });

      for (const match of matches) {
        const system = match.emrSystem;
        if (!result[system]) result[system] = [];
        if (!result[system].includes(match.name)) {
          result[system].push(match.name);
        }
      }
    }

    if (Object.keys(result).length === 0) {
      return JSON.stringify({
        error: "No matching patients found",
        searchedNames: names,
      });
    }

    return JSON.stringify(result);
  }
}
