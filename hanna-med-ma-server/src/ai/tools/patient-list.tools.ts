import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { formatDateForDisplay } from "../../core/date-format.util";

@Injectable()
export class PatientListTool {
  private readonly logger = new Logger(PatientListTool.name);

  constructor(private prisma: PrismaService) {}

  async execute(
    args: { hospital_type: string },
    doctorContext: { doctorId: number; doctorName: string },
  ): Promise<string> {
    const { hospital_type } = args;

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

    return JSON.stringify({
      hospital: hospital_type,
      count: patients.length,
      lastUpdated: formatDateForDisplay(mostRecentUpdate),
      patients: patients.map((p) => ({
        name: p.name,
        location: p.location || null,
        ...(p.facility && { facility: p.facility }),
        reason: p.reason || null,
        admittedDate: p.admittedDate || null,
      })),
    });
  }
}

@Injectable()
export class BatchPatientListTool {
  private readonly logger = new Logger(BatchPatientListTool.name);

  constructor(private patientListTool: PatientListTool) {}

  async execute(
    args: { hospital_types: string[] },
    doctorContext: { doctorId: number; doctorName: string },
  ): Promise<string> {
    const results = await Promise.all(
      args.hospital_types.map((type) =>
        this.patientListTool.execute({ hospital_type: type }, doctorContext),
      ),
    );
    return `[${results.join(",")}]`;
  }
}
