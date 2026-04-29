import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { CreateSpecialtyDto } from "./dto/create-specialty.dto";
import { UpdateSpecialtyDto } from "./dto/update-specialty.dto";

@Injectable()
export class SpecialtiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.specialty.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        systemPrompt: true,
        commonPosCodes: true,
        defaultPosCode: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { doctors: true } },
      },
    });
  }

  async findOne(id: number) {
    const row = await this.prisma.specialty.findUnique({
      where: { id },
      include: {
        doctors: {
          where: { deleted: false },
          select: { id: true, name: true, username: true },
        },
      },
    });
    if (!row) throw new NotFoundException(`Specialty ${id} not found`);
    return row;
  }

  /**
   * Validate that every code in `commonPosCodes` and `defaultPosCode`
   * exists in `place_of_service_codes` AND is active. Also enforce
   * that `defaultPosCode` (when non-null) appears in `commonPosCodes`
   * — otherwise the modal would pre-select a button that doesn't
   * render.
   */
  private async validatePosConfig(input: {
    commonPosCodes?: string[];
    defaultPosCode?: string | null;
  }) {
    const common = input.commonPosCodes ?? [];
    const def = input.defaultPosCode ?? null;
    if (common.length === 0 && def === null) return; // nothing to check

    const referenced = new Set<string>(common);
    if (def !== null) referenced.add(def);

    if (referenced.size === 0) return;

    const rows = await this.prisma.placeOfServiceCode.findMany({
      where: { code: { in: Array.from(referenced) } },
      select: { code: true, active: true },
    });
    const byCode = new Map(rows.map((r) => [r.code, r]));

    const missing: string[] = [];
    const inactive: string[] = [];
    for (const code of referenced) {
      const row = byCode.get(code);
      if (!row) missing.push(code);
      else if (!row.active) inactive.push(code);
    }
    if (missing.length > 0) {
      throw new BadRequestException(
        `POS code(s) not in catalog: ${missing.join(", ")}. Add them via POST /place-of-service-codes first.`,
      );
    }
    if (inactive.length > 0) {
      throw new BadRequestException(
        `POS code(s) are deactivated: ${inactive.join(", ")}. Reactivate or pick different codes.`,
      );
    }

    if (def !== null && !common.includes(def)) {
      throw new BadRequestException(
        `defaultPosCode "${def}" must also appear in commonPosCodes — otherwise the pre-fill points at a button that isn't rendered.`,
      );
    }
  }

  async create(dto: CreateSpecialtyDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("name cannot be empty");

    // Case-insensitive uniqueness — matches how CoderAgent used to
    // search for deltas and how the migration back-filled the table.
    const clash = await this.prisma.specialty.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        `A specialty named "${name}" already exists`,
      );
    }

    await this.validatePosConfig({
      commonPosCodes: dto.commonPosCodes,
      defaultPosCode: dto.defaultPosCode,
    });

    return this.prisma.specialty.create({
      data: {
        name,
        systemPrompt: dto.systemPrompt ?? "",
        commonPosCodes: dto.commonPosCodes ?? [],
        defaultPosCode: dto.defaultPosCode ?? null,
      },
    });
  }

  async update(id: number, dto: UpdateSpecialtyDto) {
    const existing = await this.prisma.specialty.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) throw new NotFoundException(`Specialty ${id} not found`);

    const nextName = dto.name?.trim();
    if (nextName && nextName.toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await this.prisma.specialty.findFirst({
        where: {
          name: { equals: nextName, mode: "insensitive" },
          NOT: { id },
        },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(
          `A specialty named "${nextName}" already exists`,
        );
      }
    }

    // POS config: validate against current state if either side
    // is being changed. We need to compute the post-update value so
    // the cross-check (defaultPosCode ∈ commonPosCodes) is correct.
    if (
      dto.commonPosCodes !== undefined ||
      dto.defaultPosCode !== undefined
    ) {
      const current = await this.prisma.specialty.findUnique({
        where: { id },
        select: { commonPosCodes: true, defaultPosCode: true },
      });
      const nextCommon =
        dto.commonPosCodes !== undefined
          ? dto.commonPosCodes
          : (current?.commonPosCodes ?? []);
      const nextDefault =
        dto.defaultPosCode !== undefined
          ? dto.defaultPosCode
          : (current?.defaultPosCode ?? null);
      await this.validatePosConfig({
        commonPosCodes: nextCommon,
        defaultPosCode: nextDefault,
      });
    }

    const updated = await this.prisma.specialty.update({
      where: { id },
      data: {
        ...(nextName ? { name: nextName } : {}),
        ...(dto.systemPrompt !== undefined
          ? { systemPrompt: dto.systemPrompt }
          : {}),
        ...(dto.commonPosCodes !== undefined
          ? { commonPosCodes: dto.commonPosCodes }
          : {}),
        ...(dto.defaultPosCode !== undefined
          ? { defaultPosCode: dto.defaultPosCode }
          : {}),
      },
    });

    // Keep the legacy Doctor.specialty string in sync for any doctor
    // linked to this specialty — the string field is the back-compat
    // mirror, the relation is the source of truth.
    if (nextName && nextName !== existing.name) {
      await this.prisma.doctor.updateMany({
        where: { specialtyId: id },
        data: { specialty: nextName },
      });
    }

    return updated;
  }

  async remove(id: number) {
    const existing = await this.prisma.specialty.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Specialty ${id} not found`);

    // Doctors linked to this specialty get their relation cleared
    // (FK ON DELETE SET NULL) — we ALSO clear the string mirror so
    // the two stay consistent.
    await this.prisma.doctor.updateMany({
      where: { specialtyId: id },
      data: { specialty: null },
    });

    await this.prisma.specialty.delete({ where: { id } });
    return { ok: true };
  }
}
