import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { PatientSyncService } from "./patient-sync.service";
import {
  IngestDataDto,
  IngestDataType,
  IngestErrorDto,
} from "./dto/ingest-data.dto";

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private prisma: PrismaService,
    private patientSync: PatientSyncService,
  ) {}

  async processIngest(dto: IngestDataDto) {
    // Step 1: Resolve UUID to doctorId
    const rpaNode = await this.prisma.rpaNode.findUnique({
      where: { uuid: dto.uuid },
    });

    if (!rpaNode || !rpaNode.doctorId) {
      throw new NotFoundException(
        "RPA node not found or not assigned to a doctor",
      );
    }

    const doctorId = rpaNode.doctorId;

    // Step 2: Route by data type
    switch (dto.dataType) {
      case IngestDataType.PATIENT_LIST:
        return this.handlePatientList(doctorId, dto);

      case IngestDataType.PATIENT_SUMMARY:
        return this.handleRawData(doctorId, dto, "SUMMARY");

      case IngestDataType.PATIENT_INSURANCE:
        return this.handleRawData(doctorId, dto, "INSURANCE");

      default:
        throw new Error(`Unknown data type: ${dto.dataType}`);
    }
  }

  private async handlePatientList(doctorId: number, dto: IngestDataDto) {
    const payload = dto.payload;
    const patients = payload.patients || [];
    const emrSystem = dto.hospitalType;

    const result = await this.patientSync.syncPatientList(
      doctorId,
      emrSystem,
      patients,
    );

    this.logger.log(
      `Patient list synced for ${emrSystem}: ${result.upserted} upserted, ${result.deactivated} deactivated`,
    );

    return result;
  }

  private async handleRawData(
    doctorId: number,
    dto: IngestDataDto,
    dataType: "SUMMARY" | "INSURANCE",
  ) {
    const payload = dto.payload;

    // 1. Normalize payload into an array of items to process
    interface ProcessItem {
      patientName: string;
      rawText: string;
      extractedAt: Date;
    }

    const itemsToProcess: ProcessItem[] = [];

    if (Array.isArray(payload.patients)) {
      // Batch mode: {"patients": [{"patient": "NAME", "found": true, "content": "..."}]}
      this.logger.log(
        `Processing batch ${dataType} for ${dto.hospitalType} containing ${payload.patients.length} items`,
      );
      for (const p of payload.patients) {
        if (p.found && p.content) {
          itemsToProcess.push({
            patientName: p.patient,
            rawText: p.content,
            extractedAt: new Date(),
          });
        }
      }
    } else if (payload.patientName || payload.patient_name) {
      // Single mode: accepts both camelCase and snake_case field names
      const name = payload.patientName || payload.patient_name;
      const text = payload.rawText || payload.content;
      if (name && text) {
        itemsToProcess.push({
          patientName: name,
          rawText: text,
          extractedAt: payload.extractedAt
            ? new Date(payload.extractedAt)
            : new Date(),
        });
      } else {
        this.logger.warn(
          `Single ${dataType} payload missing text content for patient "${name}"`,
        );
        return { matched: false, count: 0 };
      }
    } else {
      this.logger.warn(
        `Invalid raw data payload format for ${dataType}: no patients array or patientName found`,
      );
      return { matched: false, count: 0 };
    }

    // 2. Process each normalized item
    let processedCount = 0;
    let unmatchedCount = 0;

    for (const item of itemsToProcess) {
      // Find matching patient
      const patient = await this.patientSync.resolvePatient(
        doctorId,
        dto.hospitalType,
        item.patientName,
      );

      if (!patient) {
        this.logger.warn(
          `Could not match patient "${item.patientName}" for doctor ${doctorId}`,
        );
        unmatchedCount++;
        continue;
      }

      // UPSERT the raw data
      const existing = await this.prisma.patientRawData.findFirst({
        where: { patientId: patient.id, dataType: dataType as any },
      });

      if (existing) {
        await this.prisma.patientRawData.update({
          where: { id: existing.id },
          data: {
            rawContent: item.rawText,
            extractedAt: item.extractedAt,
          },
        });
      } else {
        await this.prisma.patientRawData.create({
          data: {
            patientId: patient.id,
            dataType: dataType as any,
            rawContent: item.rawText,
            extractedAt: item.extractedAt,
          },
        });
      }

      processedCount++;
    }

    return {
      matched: processedCount > 0,
      dataType,
      processedCount,
      unmatchedCount,
      totalProcessed: itemsToProcess.length,
    };
  }

  async handleRpaError(dto: IngestErrorDto) {
    this.logger.warn(
      `RPA Error from ${dto.uuid} at ${dto.hospitalType}: ${dto.error}`,
    );

    // Resolve UUID → doctorId
    const rpaNode = await this.prisma.rpaNode.findUnique({
      where: { uuid: dto.uuid },
    });

    if (!rpaNode?.doctorId) return;

    // Find or create chat session
    let session = await this.prisma.chatSession.findUnique({
      where: { doctorId: rpaNode.doctorId },
    });

    if (!session) {
      session = await this.prisma.chatSession.create({
        data: { doctorId: rpaNode.doctorId },
      });
    }

    // Save error as ASSISTANT message so the doctor sees it
    const errorMessage = `I apologize, Doctor. I encountered an issue while retrieving data from ${dto.hospitalType}. Please ensure the hospital portal is open and accessible on your office computer. If the problem persists, contact support.`;

    await this.prisma.message.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: errorMessage,
        type: "ERROR",
      },
    });
  }

  /**
   * Get all active patients for a doctor.
   */
  async getPatients(
    doctorId: number,
    emrSystem?: string,
    activeOnly: boolean = true,
  ) {
    return this.prisma.patient.findMany({
      where: {
        doctorId,
        ...(emrSystem ? { emrSystem: emrSystem as any } : {}),
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: {
        rawData: {
          select: { id: true, dataType: true, extractedAt: true },
        },
      },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Get raw data for a specific patient.
   */
  async getPatientRawData(patientId: number, dataType?: string) {
    return this.prisma.patientRawData.findMany({
      where: {
        patientId,
        ...(dataType ? { dataType: dataType as any } : {}),
      },
      orderBy: { extractedAt: "desc" },
    });
  }
}
