import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseIntPipe,
	Patch,
	Post,
	UseGuards,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiParam,
	ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SpecialtiesService } from "./specialties.service";
import { CreateSpecialtyDto } from "./dto/create-specialty.dto";
import { UpdateSpecialtyDto } from "./dto/update-specialty.dto";

@ApiTags("Specialties")
@Controller("specialties")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class SpecialtiesController {
	constructor(private readonly specialties: SpecialtiesService) {}

	@Get()
	@ApiOperation({
		summary:
			"List every specialty with its prompt delta and doctor count",
	})
	findAll() {
		return this.specialties.findAll();
	}

	@Get(":id")
	@ApiOperation({ summary: "Fetch one specialty with its linked doctors" })
	@ApiParam({ name: "id", type: "number" })
	findOne(@Param("id", ParseIntPipe) id: number) {
		return this.specialties.findOne(id);
	}

	@Post()
	@ApiOperation({ summary: "Create a specialty" })
	create(@Body() dto: CreateSpecialtyDto) {
		return this.specialties.create(dto);
	}

	@Patch(":id")
	@ApiOperation({
		summary:
			"Update a specialty's name or system prompt. Linked doctors' Doctor.specialty string is kept in sync with the new name.",
	})
	@ApiParam({ name: "id", type: "number" })
	update(
		@Param("id", ParseIntPipe) id: number,
		@Body() dto: UpdateSpecialtyDto,
	) {
		return this.specialties.update(id, dto);
	}

	@Delete(":id")
	@ApiOperation({
		summary:
			"Delete a specialty. Linked doctors' specialty fields are cleared (FK + string).",
	})
	@ApiParam({ name: "id", type: "number" })
	remove(@Param("id", ParseIntPipe) id: number) {
		return this.specialties.remove(id);
	}
}
