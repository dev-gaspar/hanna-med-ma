import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { IngestService } from "./ingest.service";
import { IngestDataDto, IngestErrorDto } from "./dto/ingest-data.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("RPA Ingestion")
@Controller("rpa")
export class IngestController {
  private readonly logger = new Logger(IngestController.name);

  constructor(private readonly ingestService: IngestService) {}

  @Post("ingest")
  @ApiOperation({ summary: "Ingest data from RPA node" })
  @ApiBody({ type: IngestDataDto })
  @ApiResponse({ status: 201, description: "Data ingested successfully" })
  async ingestData(@Body() dto: IngestDataDto) {
    this.logger.log(
      `Ingest: ${dto.dataType} from ${dto.hospitalType} (UUID: ${dto.uuid})`,
    );
    const result = await this.ingestService.processIngest(dto);
    return { success: true, message: `Data ingested: ${dto.dataType}`, result };
  }

  @Post("error")
  @ApiOperation({ summary: "Report RPA error" })
  @ApiBody({ type: IngestErrorDto })
  @ApiResponse({ status: 200, description: "Error reported" })
  async reportError(@Body() dto: IngestErrorDto) {
    this.logger.warn(`RPA Error from ${dto.uuid}: ${dto.error}`);
    await this.ingestService.handleRpaError(dto);
    return { success: true };
  }

  @Get("patients")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get patients for the authenticated doctor" })
  @ApiQuery({ name: "emrSystem", required: false })
  @ApiQuery({ name: "active", required: false })
  async getPatients(
    @Request() req,
    @Query("emrSystem") emrSystem?: string,
    @Query("active") active?: string,
  ) {
    const doctorId = req.user.userId;
    return this.ingestService.getPatients(
      doctorId,
      emrSystem,
      active !== "false",
    );
  }

  @Get("patients/:id/raw")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get raw data for a patient" })
  @ApiParam({ name: "id", type: "number" })
  @ApiQuery({ name: "dataType", required: false })
  async getPatientRawData(
    @Param("id", ParseIntPipe) patientId: number,
    @Query("dataType") dataType?: string,
  ) {
    return this.ingestService.getPatientRawData(patientId, dataType);
  }
}
