import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { CreateDoctorDto } from "./dto/create-doctor.dto";
import { UpdateDoctorDto } from "./dto/update-doctor.dto";
import * as bcrypt from "bcrypt";

@Injectable()
export class DoctorsService {
  constructor(private prisma: PrismaService) {}

  // When a DTO carries specialtyId, the Specialty relation is the
  // source of truth — look up the name and overwrite the legacy
  // `specialty` string with it. When neither is set, both fields are
  // cleared. When only `specialty` (string) is set, the relation
  // stays null (back-compat path for any legacy caller).
  private async resolveSpecialty(
    dto: { specialtyId?: number | null; specialty?: string | null },
  ): Promise<{ specialtyId: number | null; specialty: string | null }> {
    if (dto.specialtyId != null) {
      const row = await this.prisma.specialty.findUnique({
        where: { id: dto.specialtyId },
        select: { id: true, name: true },
      });
      if (!row) {
        throw new BadRequestException(
          `Specialty ${dto.specialtyId} does not exist`,
        );
      }
      return { specialtyId: row.id, specialty: row.name };
    }
    if (dto.specialty !== undefined) {
      return {
        specialtyId: null,
        specialty: dto.specialty?.trim() || null,
      };
    }
    // DTO didn't touch specialty at all — callers handle "no change"
    // separately so we never get here with both undefined.
    return { specialtyId: null, specialty: null };
  }

  async create(createDoctorDto: CreateDoctorDto) {
    const hashedPassword = await bcrypt.hash(createDoctorDto.password, 10);
    const { specialty, specialtyId, ...rest } = createDoctorDto;

    const resolved = await this.resolveSpecialty({ specialty, specialtyId });

    const doctor = await this.prisma.doctor.create({
      data: {
        ...rest,
        password: hashedPassword,
        specialty: resolved.specialty,
        specialtyId: resolved.specialtyId,
      },
    });

    return this.findOne(doctor.id);
  }

  async findAll() {
    return this.prisma.doctor.findMany({
      where: {
        deleted: false,
      },
      include: {
        rpaNodes: {
          select: { id: true, uuid: true, status: true, lastSeen: true },
        },
        specialtyRel: { select: { id: true, name: true } },
      },
    });
  }

  async findOne(id: number) {
    const doctor = await this.prisma.doctor.findFirst({
      where: {
        id,
        deleted: false,
      },
      include: {
        rpaNodes: {
          select: { id: true, uuid: true, status: true, lastSeen: true },
        },
        specialtyRel: { select: { id: true, name: true } },
      },
    });

    if (!doctor) {
      throw new NotFoundException(`Doctor with ID ${id} not found`);
    }

    return doctor;
  }

  async update(id: number, updateDoctorDto: UpdateDoctorDto) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id },
    });

    if (!doctor || doctor.deleted) {
      throw new NotFoundException(
        `Doctor with ID ${id} not found or has been deleted`,
      );
    }

    // Hash password if provided
    const updateData: Record<string, unknown> = { ...updateDoctorDto };
    if (updateData.password) {
      updateData.password = await bcrypt.hash(
        updateData.password as string,
        10,
      );
    } else {
      delete updateData.password;
    }

    // Only touch specialty fields when the DTO explicitly sent them.
    if (
      Object.prototype.hasOwnProperty.call(updateDoctorDto, "specialtyId") ||
      Object.prototype.hasOwnProperty.call(updateDoctorDto, "specialty")
    ) {
      const resolved = await this.resolveSpecialty({
        specialtyId: updateDoctorDto.specialtyId,
        specialty: updateDoctorDto.specialty,
      });
      updateData.specialty = resolved.specialty;
      updateData.specialtyId = resolved.specialtyId;
    } else {
      delete updateData.specialty;
      delete updateData.specialtyId;
    }

    return this.prisma.doctor.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: number) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id },
    });

    if (!doctor || doctor.deleted) {
      throw new NotFoundException(
        `Doctor with ID ${id} not found or has been deleted`,
      );
    }

    return this.prisma.doctor.update({
      where: { id },
      data: { deleted: true },
    });
  }

  async findByUsername(username: string) {
    return this.prisma.doctor.findFirst({
      where: {
        username,
        deleted: false,
      },
    });
  }
}
