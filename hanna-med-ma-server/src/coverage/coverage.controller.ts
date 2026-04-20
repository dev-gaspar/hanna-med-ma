import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiQuery,
	ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CoverageService } from "./coverage.service";

@ApiTags("Coverage")
@Controller("coverage")
export class CoverageController {
	constructor(private readonly coverage: CoverageService) {}

	@Get("fee-schedule")
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({
		summary:
			"Localized Medicare Physician Fee Schedule lookup (CPT + locality + year)",
	})
	@ApiQuery({ name: "cpt", required: true, example: "99214" })
	@ApiQuery({ name: "locality", required: true, example: "04" })
	@ApiQuery({ name: "state", required: false, example: "FL" })
	@ApiQuery({ name: "year", required: false, example: 2026 })
	@ApiQuery({ name: "modifier", required: false, example: "26" })
	async feeSchedule(
		@Query("cpt") cpt: string,
		@Query("locality") locality: string,
		@Query("state") state?: string,
		@Query("year") year?: string,
		@Query("modifier") modifier?: string,
	) {
		return this.coverage.findFee({
			cpt,
			locality,
			state,
			year: year ? Number(year) : new Date().getFullYear(),
			modifier,
		});
	}
}
