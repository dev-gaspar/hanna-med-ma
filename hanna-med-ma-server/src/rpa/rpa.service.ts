import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { RegisterRpaDto } from "./dto/register-rpa.dto";
import { CredentialsService } from "../credentials/credentials.service";

@Injectable()
export class RpaService {
  private readonly logger = new Logger(RpaService.name);

  constructor(
    private prisma: PrismaService,
    private credentialsService: CredentialsService,
  ) {}

  /**
   * Register a new RPA node or return existing one.
   */
  async register(dto: RegisterRpaDto) {
    const existing = await this.prisma.rpaNode.findUnique({
      where: { uuid: dto.uuid },
    });

    if (existing) {
      // Update hostname and lastSeen
      const updated = await this.prisma.rpaNode.update({
        where: { uuid: dto.uuid },
        data: {
          hostname: dto.hostname || existing.hostname,
          lastSeen: new Date(),
        },
        include: { doctor: { select: { id: true, name: true } } },
      });

      this.logger.log(`RPA node re-registered: ${dto.uuid}`);
      return {
        uuid: updated.uuid,
        status: updated.status,
        doctorId: updated.doctorId,
        doctorName: updated.doctor?.name || null,
      };
    }

    // Create new node
    const node = await this.prisma.rpaNode.create({
      data: {
        uuid: dto.uuid,
        hostname: dto.hostname,
      },
    });

    this.logger.log(`New RPA node registered: ${dto.uuid} (${dto.hostname})`);
    return {
      uuid: node.uuid,
      status: node.status,
      doctorId: null,
      doctorName: null,
    };
  }

  /**
   * Get configuration for an RPA node (credentials, hospitals, etc.)
   */
  async getConfig(uuid: string) {
    const node = await this.prisma.rpaNode.findUnique({
      where: { uuid },
      include: {
        doctor: {
          include: {
            credentials: true,
          },
        },
      },
    });

    if (!node) {
      throw new NotFoundException(`RPA node ${uuid} not found`);
    }

    if (!node.doctorId || !node.doctor) {
      return {
        uuid: node.uuid,
        status: node.status,
        doctorId: null,
        credentials: [],
        hospitals: [],
      };
    }

    // Decrypt credentials before sending to RPA
    const decryptedCredentials = await this.credentialsService.findByDoctor(
      node.doctorId,
    );

    // Build hospital list from doctor.emrSystems (source of truth for access)
    // Attach credentials only for systems that have them
    const credsBySystem = new Map<string, Record<string, string>>(
      decryptedCredentials.map((c) => [
        c.systemKey as string,
        c.fields as Record<string, string>,
      ]),
    );

    const hospitals = (node.doctor.emrSystems || []).map((system: string) => ({
      type: system,
      credentials: credsBySystem.get(system) || {},
    }));

    return {
      uuid: node.uuid,
      status: node.status,
      doctorId: node.doctorId,
      doctorName: node.doctor.name,
      doctorSpecialty: node.doctor.specialty,
      credentials: decryptedCredentials,
      hospitals,
    };
  }

  /**
   * Update heartbeat timestamp for an RPA node.
   */
  async heartbeat(uuid: string) {
    const node = await this.prisma.rpaNode.findUnique({
      where: { uuid },
    });

    if (!node) {
      throw new NotFoundException(`RPA node ${uuid} not found`);
    }

    await this.prisma.rpaNode.update({
      where: { uuid },
      data: {
        lastSeen: new Date(),
        status: node.doctorId ? "ACTIVE" : node.status,
      },
    });

    return { success: true };
  }

  /**
   * Assign an RPA node to a doctor (admin action).
   */
  async assignToDoctor(uuid: string, doctorId: number) {
    const node = await this.prisma.rpaNode.findUnique({
      where: { uuid },
    });

    if (!node) {
      throw new NotFoundException(`RPA node ${uuid} not found`);
    }

    const doctor = await this.prisma.doctor.findFirst({
      where: { id: doctorId, deleted: false },
    });

    if (!doctor) {
      throw new NotFoundException(`Doctor ${doctorId} not found`);
    }

    const updated = await this.prisma.rpaNode.update({
      where: { uuid },
      data: {
        doctorId,
        status: "ACTIVE",
      },
      include: { doctor: { select: { id: true, name: true } } },
    });

    this.logger.log(`RPA node ${uuid} assigned to Doctor ${doctor.name}`);
    return updated;
  }

  /**
   * List all RPA nodes (admin).
   */
  async findAll() {
    return this.prisma.rpaNode.findMany({
      include: { doctor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
}
