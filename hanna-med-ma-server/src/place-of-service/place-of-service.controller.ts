import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreatePlaceOfServiceCodeDto } from "./dto/create-pos-code.dto";
import { UpdatePlaceOfServiceCodeDto } from "./dto/update-pos-code.dto";
import { PlaceOfServiceService } from "./place-of-service.service";

/**
 * CMS Place-of-Service code catalog.
 *
 * Read access is open to any authenticated user (the doctor's
 * "Mark as seen" modal needs the active list to render quick-picks
 * and the full select). Write endpoints are guarded the same way
 * the Specialties endpoints are — auth required, future admin-role
 * gating goes through the same JwtAuthGuard.
 */
@ApiTags("PlaceOfService")
@Controller("place-of-service-codes")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class PlaceOfServiceController {
  constructor(private readonly service: PlaceOfServiceService) {}

  @Get()
  @ApiOperation({
    summary:
      "List CMS Place-of-Service codes. Defaults to active only; pass includeInactive=true for the admin UI.",
  })
  @ApiQuery({ name: "includeInactive", required: false, type: "boolean" })
  findAll(@Query("includeInactive") includeInactive?: string) {
    return this.service.findAll(includeInactive === "true");
  }

  @Get(":code")
  @ApiOperation({ summary: "Fetch one POS code." })
  @ApiParam({ name: "code", example: "11" })
  findOne(@Param("code") code: string) {
    return this.service.findOne(code);
  }

  @Post()
  @ApiOperation({
    summary:
      "Create a new POS code. Admin endpoint — most catalog rows come from the CMS loader, this is for ad-hoc additions.",
  })
  create(@Body() dto: CreatePlaceOfServiceCodeDto) {
    return this.service.create(dto);
  }

  @Patch(":code")
  @ApiOperation({
    summary:
      "Update a POS code's display fields (name, shortLabel, description, active).",
  })
  @ApiParam({ name: "code", example: "11" })
  update(
    @Param("code") code: string,
    @Body() dto: UpdatePlaceOfServiceCodeDto,
  ) {
    return this.service.update(code, dto);
  }

  @Delete(":code")
  @ApiOperation({
    summary:
      "Deactivate (soft-retire) a POS code. Refuses if any Specialty still references the code.",
  })
  @ApiParam({ name: "code", example: "99" })
  deactivate(@Param("code") code: string) {
    return this.service.deactivate(code);
  }
}
