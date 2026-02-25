import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { formatDateForDisplay } from "../../core/date-format.util";

@Injectable()
export class PatientInsuranceTool {
  private readonly logger = new Logger(PatientInsuranceTool.name);

  constructor(private prisma: PrismaService) {}

  async execute(
    args: { hospital_type: string; patient_name: string },
    doctorContext: { doctorId: number },
  ): Promise<string> {
    const { hospital_type, patient_name } = args;

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
          where: { dataType: "INSURANCE" },
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
      return JSON.stringify({
        error: true,
        patientName: patient.name,
        hospital: hospital_type,
        message: `Found ${patient.name} in ${hospital_type}, but no insurance information is available yet.`,
      });
    }

    return JSON.stringify({
      patientName: patient.name,
      hospital: hospital_type,
      extractedAt: formatDateForDisplay(rawData.extractedAt),
      rawContent: rawData.rawContent,
    });
  }
}

@Injectable()
export class BatchPatientInsuranceTool {
  private readonly logger = new Logger(BatchPatientInsuranceTool.name);

  constructor(private insuranceTool: PatientInsuranceTool) {}

  async execute(
    args: { hospital_type: string; patient_names: string[] },
    doctorContext: { doctorId: number },
  ): Promise<string> {
    const results = await Promise.all(
      args.patient_names.map((name) =>
        this.insuranceTool.execute(
          { hospital_type: args.hospital_type, patient_name: name },
          doctorContext,
        ),
      ),
    );
    return `[${results.join(",")}]`;
  }
}
