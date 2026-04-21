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

		return this.prisma.specialty.create({
			data: { name, systemPrompt: dto.systemPrompt ?? "" },
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

		const updated = await this.prisma.specialty.update({
			where: { id },
			data: {
				...(nextName ? { name: nextName } : {}),
				...(dto.systemPrompt !== undefined
					? { systemPrompt: dto.systemPrompt }
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
