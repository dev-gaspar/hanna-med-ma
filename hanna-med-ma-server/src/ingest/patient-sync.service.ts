import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { normalizeName } from "../core/patient-name.util";

@Injectable()
export class PatientSyncService {
  private readonly logger = new Logger(PatientSyncService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Sync a patient list from the EMR with the database.
   *
   * - UPSERT Patient globally (shared across doctors).
   * - UPSERT DoctorPatient link (per-doctor census membership).
   * - DEACTIVATE DoctorPatient links NOT in the current census.
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

    const activePatientIds: number[] = [];

    for (const p of patients) {
      const normalizedName = normalizeName(p.name);

      // Step 1: Upsert the global Patient record
      const patient = await this.prisma.patient.upsert({
        where: {
          emrSystem_normalizedName: {
            emrSystem: emrSystem as any,
            normalizedName,
          },
        },
        create: {
          emrSystem: emrSystem as any,
          name: p.name,
          normalizedName,
          location: p.location || null,
          facility: p.facility || null,
          reason: p.reason || null,
          admittedDate: p.admittedDate || null,
        },
        update: {
          name: p.name,
          location: p.location || null,
          facility: p.facility || null,
          reason: p.reason || null,
          admittedDate: p.admittedDate || null,
        },
      });

      activePatientIds.push(patient.id);

      // Step 2: Upsert the DoctorPatient link for this doctor
      await this.prisma.doctorPatient.upsert({
        where: {
          doctorId_patientId: { doctorId, patientId: patient.id },
        },
        create: {
          doctorId,
          patientId: patient.id,
          isActive: true,
          lastSeenAt: now,
        },
        update: {
          isActive: true,
          lastSeenAt: now,
        },
      });

      upserted++;
    }

    // Step 3: Deactivate DoctorPatient links not in the current census
    // (only for this doctor + emrSystem combination)
    const deactivateResult = await this.prisma.doctorPatient.updateMany({
      where: {
        doctorId,
        isActive: true,
        patientId: { notIn: activePatientIds.length > 0 ? activePatientIds : [0] },
        patient: { emrSystem: emrSystem as any },
      },
      data: { isActive: false },
    });

    deactivated = deactivateResult.count;

    if (deactivated > 0) {
      this.logger.log(
        `Deactivated ${deactivated} ghost doctor-patient links from ${emrSystem} for doctor ${doctorId}`,
      );
    }

    return { upserted, deactivated };
  }

  /**
   * Find a patient by name (fuzzy matching) within a doctor's census.
   */
  async resolvePatient(
    doctorId: number,
    hospitalType: string,
    patientName: string,
  ) {
    const normalizedInput = normalizeName(patientName);

    // Strategy 1: Exact match
    const exactMatch = await this.prisma.patient.findFirst({
      where: {
        emrSystem: hospitalType as any,
        normalizedName: normalizedInput,
        doctorLinks: { some: { doctorId, isActive: true } },
      },
    });

    if (exactMatch) return exactMatch;

    // Strategy 2: Last name prefix match
    const lastName = normalizedInput.split(" ")[0];
    const partialMatch = await this.prisma.patient.findFirst({
      where: {
        emrSystem: hospitalType as any,
        normalizedName: { startsWith: lastName },
        doctorLinks: { some: { doctorId, isActive: true } },
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
        emrSystem: hospitalType as any,
        normalizedName: { contains: lastName },
        doctorLinks: { some: { doctorId, isActive: true } },
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
