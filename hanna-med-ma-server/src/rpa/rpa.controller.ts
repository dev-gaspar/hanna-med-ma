import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseIntPipe,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { RpaService } from "./rpa.service";
import { RegisterRpaDto } from "./dto/register-rpa.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("RPA")
@Controller("rpa")
export class RpaController {
  constructor(private readonly rpaService: RpaService) {}

  @Post("register")
  @ApiOperation({
    summary: "Register an RPA node (Plug & Play)",
    description:
      "Called by RPA agents on startup to register with a UUID. No auth required.",
  })
  @ApiBody({ type: RegisterRpaDto })
  @ApiResponse({ status: 201, description: "RPA node registered" })
  async register(@Body() dto: RegisterRpaDto) {
    return this.rpaService.register(dto);
  }

  @Get(":uuid/config")
  @ApiOperation({
    summary: "Get RPA node configuration",
    description: "Returns doctor credentials and hospital configs if assigned.",
  })
  @ApiParam({ name: "uuid", type: "string" })
  @ApiResponse({ status: 200, description: "Configuration retrieved" })
  @ApiResponse({ status: 404, description: "Node not found" })
  async getConfig(@Param("uuid") uuid: string) {
    return this.rpaService.getConfig(uuid);
  }

  @Post(":uuid/heartbeat")
  @ApiOperation({
    summary: "RPA node heartbeat",
    description: "Updates lastSeen timestamp for the node.",
  })
  @ApiParam({ name: "uuid", type: "string" })
  @ApiResponse({ status: 200, description: "Heartbeat updated" })
  async heartbeat(@Param("uuid") uuid: string) {
    return this.rpaService.heartbeat(uuid);
  }

  @Post(":uuid/assign/:doctorId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Assign RPA node to a doctor (Admin)",
    description: "Link an RPA node to a specific doctor.",
  })
  @ApiParam({ name: "uuid", type: "string" })
  @ApiParam({ name: "doctorId", type: "number" })
  @ApiResponse({ status: 200, description: "Node assigned successfully" })
  async assignToDoctor(
    @Param("uuid") uuid: string,
    @Param("doctorId", ParseIntPipe) doctorId: number,
  ) {
    return this.rpaService.assignToDoctor(uuid, doctorId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "List all RPA nodes (Admin)" })
  @ApiResponse({ status: 200, description: "List of RPA nodes" })
  async findAll() {
    return this.rpaService.findAll();
  }

  @Post("caretracker/test/:patientId")
  @ApiOperation({
    summary: "Test CareTracker dispatch for any patient",
    description:
      "Loads INSURANCE raw data from the given patientId, formats payload with AI, and dispatches to RPA asynchronously.",
  })
  @ApiParam({ name: "patientId", type: "number" })
  @ApiResponse({ status: 201, description: "Dispatch accepted" })
  @ApiResponse({
    status: 404,
    description: "Patient or insurance raw data not found",
  })
  async testCareTrackerByPatientId(
    @Param("patientId", ParseIntPipe) patientId: number,
  ) {
    return this.rpaService.dispatchCareTrackerForPatientId(patientId);
  }

  @Patch("patients/seen-by-name")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Mark patient as seen by name (direct DB lookup)",
    description:
      "Resolves the patient by display name in the local database and triggers the mark-as-seen + billing EMR flow. No multi-system search needed.",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: { patientName: { type: "string" } },
      required: ["patientName"],
    },
  })
  @ApiResponse({ status: 200, description: "Patient marked as seen" })
  @ApiResponse({ status: 404, description: "Patient not found" })
  async markPatientAsSeenByName(@Body("patientName") patientName: string) {
    return this.rpaService.markPatientAsSeenByName(patientName);
  }

  @Patch("patients/:patientId/seen")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Mark patient as seen by ID and trigger billing EMR registration",
    description:
      "Toggles isSeen to true and handles billing EMR logic.",
  })
  @ApiParam({ name: "patientId", type: "number" })
  @ApiResponse({ status: 200, description: "Patient marked as seen" })
  async markPatientAsSeen(@Param("patientId", ParseIntPipe) patientId: number) {
    return this.rpaService.markPatientAsSeen(patientId);
  }
}
