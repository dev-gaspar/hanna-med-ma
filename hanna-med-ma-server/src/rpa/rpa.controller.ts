import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
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
import { CaretrackerResultDto } from "./dto/caretracker-result.dto";
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

  @Post("caretracker/result")
  @ApiOperation({
    summary: "Receive CareTracker result from RPA Node",
    description:
      "Called by the headless RPA node after finishing the CareTracker flow to report the outcome.",
  })
  @ApiBody({ type: CaretrackerResultDto })
  @ApiResponse({ status: 201, description: "Result processed" })
  async handleCareTrackerResult(@Body() dto: CaretrackerResultDto) {
    return this.rpaService.handleCareTrackerResult(dto);
  }

  @Patch("patients/:patientId/seen")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Mark patient as seen — creates an Encounter and triggers billing EMR registration",
    description:
      "Creates an Encounter linking the doctor (from JWT) and patient. Send encounterType: CONSULT (first visit) or PROGRESS (follow-up).",
  })
  @ApiParam({ name: "patientId", type: "number" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        encounterType: {
          type: "string",
          enum: ["CONSULT", "PROGRESS"],
          default: "CONSULT",
        },
      },
    },
    required: false,
  })
  @ApiResponse({ status: 200, description: "Encounter created" })
  async markPatientAsSeen(
    @Param("patientId", ParseIntPipe) patientId: number,
    @Body() body: { encounterType?: "CONSULT" | "PROGRESS" },
    @Request() req,
  ) {
    const doctorId = req.user.userId;
    const encounterType = body?.encounterType || "CONSULT";
    return this.rpaService.markPatientAsSeen(patientId, doctorId, encounterType);
  }
  @Get("patients/seen")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get IDs of all patients seen by the current doctor" })
  @ApiResponse({ status: 200, description: "List of seen patient IDs", type: [Number] })
  async getSeenPatients(@Request() req) {
    const doctorId = req.user.userId;
    return this.rpaService.getSeenPatientIds(doctorId);
  }
}
