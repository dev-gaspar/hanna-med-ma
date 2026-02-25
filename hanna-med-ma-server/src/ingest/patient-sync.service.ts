import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";

@Injectable()
export class PatientSyncService {
  private readonly logger = new Logger(PatientSyncService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Normalize a patient name for matching.
   * "GARCIA, JOSE" → "garcia jose"
   */
  normalizeName(name: string): string {
    return name.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim();
  }

  /**
   * Sync a patient list from the EMR with the database.
   *
   * - UPSERT: Create or update patients found in the census.
   * - DEACTIVATE: Mark patients NOT in the census as inactive.
   */
  async syncPatientList(
    doctorId: number,
    emrSystem: string,
    patients: Array<{
      name: string;
      location?: string;
      facility?: string;
      reason?: string;
      admittedDate?: string;
    }>,
  ) {
    const now = new Date();
    let upserted = 0;
    let deactivated = 0;

    // Step 1: UPSERT each patient from the census
    const activeNormalizedNames: string[] = [];

    for (const p of patients) {
      const normalizedName = this.normalizeName(p.name);
      activeNormalizedNames.push(normalizedName);

      await this.prisma.patient.upsert({
        where: {
          doctorId_emrSystem_normalizedName: {
            doctorId,
            emrSystem: emrSystem as any,
            normalizedName,
          },
        },
        create: {
          doctorId,
          emrSystem: emrSystem as any,
          name: p.name,
          normalizedName,
          location: p.location || null,
          facility: p.facility || null,
          reason: p.reason || null,
          admittedDate: p.admittedDate || null,
          isActive: true,
          lastSeenAt: now,
        },
        update: {
          name: p.name,
          location: p.location || null,
          facility: p.facility || null,
          reason: p.reason || null,
          admittedDate: p.admittedDate || null,
          isActive: true,
          lastSeenAt: now,
        },
      });

      upserted++;
    }

    // Step 2: DEACTIVATE patients not in the current census
    const deactivateResult = await this.prisma.patient.updateMany({
      where: {
        doctorId,
        emrSystem: emrSystem as any,
        isActive: true,
        normalizedName: {
          notIn: activeNormalizedNames,
        },
      },
      data: {
        isActive: false,
      },
    });

    deactivated = deactivateResult.count;

    if (deactivated > 0) {
      this.logger.log(
        `Deactivated ${deactivated} ghost patients from ${emrSystem} for doctor ${doctorId}`,
      );
    }

    return { upserted, deactivated };
  }

  /**
   * Find a patient by name (fuzzy matching).
   */
  async resolvePatient(
    doctorId: number,
    hospitalType: string,
    patientName: string,
  ) {
    const normalizedInput = this.normalizeName(patientName);

    // Strategy 1: Exact match
    const exactMatch = await this.prisma.patient.findFirst({
      where: {
        doctorId,
        emrSystem: hospitalType as any,
        normalizedName: normalizedInput,
        isActive: true,
      },
    });

    if (exactMatch) return exactMatch;

    // Strategy 2: Last name prefix match
    const lastName = normalizedInput.split(" ")[0];
    const partialMatch = await this.prisma.patient.findFirst({
      where: {
        doctorId,
        emrSystem: hospitalType as any,
        normalizedName: { startsWith: lastName },
        isActive: true,
      },
    });

    if (partialMatch) {
      this.logger.log(
        `Fuzzy matched: "${patientName}" → "${partialMatch.name}"`,
      );
      return partialMatch;
    }

    // Strategy 3: Contains match
    const containsMatch = await this.prisma.patient.findFirst({
      where: {
        doctorId,
        emrSystem: hospitalType as any,
        normalizedName: { contains: lastName },
        isActive: true,
      },
    });

    if (containsMatch) {
      this.logger.log(
        `Contains matched: "${patientName}" → "${containsMatch.name}"`,
      );
      return containsMatch;
    }

    this.logger.warn(
      `No patient match found for "${patientName}" in ${hospitalType}`,
    );
    return null;
  }
}
