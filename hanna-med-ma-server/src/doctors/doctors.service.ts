import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { CreateDoctorDto } from "./dto/create-doctor.dto";
import { UpdateDoctorDto } from "./dto/update-doctor.dto";
import * as bcrypt from "bcrypt";

@Injectable()
export class DoctorsService {
  constructor(private prisma: PrismaService) {}

  async create(createDoctorDto: CreateDoctorDto) {
    // Hash password before saving
    const hashedPassword = await bcrypt.hash(createDoctorDto.password, 10);

    const doctor = await this.prisma.doctor.create({
      data: {
        ...createDoctorDto,
        password: hashedPassword,
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
    const updateData = { ...updateDoctorDto };
    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    } else {
      delete updateData.password;
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
