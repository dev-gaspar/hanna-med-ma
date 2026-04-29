import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { CreatePlaceOfServiceCodeDto } from "./dto/create-pos-code.dto";
import { UpdatePlaceOfServiceCodeDto } from "./dto/update-pos-code.dto";

@Injectable()
export class PlaceOfServiceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List the catalog. By default returns active codes only — pass
   * `includeInactive=true` to include retired ones (admin UI).
   * Sorted by numeric code so quick-pick UIs render predictably.
   */
  async findAll(includeInactive = false) {
    const rows = await this.prisma.placeOfServiceCode.findMany({
      where: includeInactive ? {} : { active: true },
    });
    return rows.sort((a, b) => Number(a.code) - Number(b.code));
  }

  async findOne(code: string) {
    const row = await this.prisma.placeOfServiceCode.findUnique({
      where: { code },
    });
    if (!row) throw new NotFoundException(`POS code "${code}" not found`);
    return row;
  }

  async create(dto: CreatePlaceOfServiceCodeDto) {
    const existing = await this.prisma.placeOfServiceCode.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `POS code "${dto.code}" already exists — use PATCH to edit it.`,
      );
    }
    return this.prisma.placeOfServiceCode.create({
      data: {
        code: dto.code,
        name: dto.name,
        shortLabel: dto.shortLabel,
        description: dto.description,
        active: dto.active ?? true,
      },
    });
  }

  async update(code: string, dto: UpdatePlaceOfServiceCodeDto) {
    const existing = await this.prisma.placeOfServiceCode.findUnique({
      where: { code },
    });
    if (!existing) throw new NotFoundException(`POS code "${code}" not found`);
    return this.prisma.placeOfServiceCode.update({
      where: { code },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.shortLabel !== undefined ? { shortLabel: dto.shortLabel } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  /**
   * Soft-retire a code by flipping `active=false`. We don't hard-
   * delete because the `code` is referenced by `Encounter.placeOfService`
   * and `Specialty.commonPosCodes` historically — deleting would break
   * audit trails. If admin really wants the row gone, they can flip
   * active=false and remove all references first.
   */
  async deactivate(code: string) {
    const existing = await this.prisma.placeOfServiceCode.findUnique({
      where: { code },
    });
    if (!existing) throw new NotFoundException(`POS code "${code}" not found`);

    // Refuse to deactivate a code that is the defaultPosCode for any
    // specialty, or appears in any specialty's commonPosCodes — the
    // admin must clean up the references first.
    const referencingSpecialties = await this.prisma.specialty.findMany({
      where: {
        OR: [
          { defaultPosCode: code },
          { commonPosCodes: { has: code } },
        ],
      },
      select: { id: true, name: true },
    });
    if (referencingSpecialties.length > 0) {
      throw new BadRequestException(
        `Cannot deactivate "${code}" — referenced by specialties: ${referencingSpecialties
          .map((s) => `${s.name} (id=${s.id})`)
          .join(", ")}. Remove the references first.`,
      );
    }

    return this.prisma.placeOfServiceCode.update({
      where: { code },
      data: { active: false },
    });
  }
}
