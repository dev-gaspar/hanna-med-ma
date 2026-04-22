import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
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
    summary:
      "Mark patient as seen — creates an Encounter and triggers billing EMR registration",
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
        dateOfService: {
          type: "string",
          format: "date",
          description:
            "Optional ISO date (YYYY-MM-DD). If omitted, today's date is used. Useful when the doctor is catching up on a visit from a previous day.",
        },
      },
    },
    required: false,
  })
  @ApiResponse({ status: 200, description: "Encounter created" })
  async markPatientAsSeen(
    @Param("patientId", ParseIntPipe) patientId: number,
    @Body()
    body: {
      encounterType?: "CONSULT" | "PROGRESS";
      dateOfService?: string;
    },
    @Request() req,
  ) {
    const doctorId = req.user.userId;
    const encounterType = body?.encounterType || "CONSULT";
    const dateOfService = body?.dateOfService
      ? new Date(body.dateOfService)
      : undefined;
    return this.rpaService.markPatientAsSeen(
      patientId,
      doctorId,
      encounterType,
      dateOfService,
    );
  }

  @Get(":uuid/patients/data-status")
  @ApiOperation({
    summary: "Get data availability status for all active patients",
    description:
      "Returns which data types (summary, insurance, lab) each patient already has. Used by RPA for smart extraction.",
  })
  @ApiParam({ name: "uuid", type: "string" })
  @ApiQuery({ name: "emrSystem", required: true })
  @ApiResponse({ status: 200, description: "Patient data status map" })
  async getPatientDataStatus(
    @Param("uuid") uuid: string,
    @Query("emrSystem") emrSystem: string,
  ) {
    return this.rpaService.getPatientDataStatus(uuid, emrSystem);
  }

  @Get("patients/seen")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Get IDs of all patients seen by the current doctor",
  })
  @ApiResponse({
    status: 200,
    description: "List of seen patient IDs",
    type: [Number],
  })
  async getSeenPatients(@Request() req) {
    const doctorId = req.user.userId;
    return this.rpaService.getSeenPatientIds(doctorId);
  }

  @Patch("encounters/:encounterId/note")
  @ApiOperation({
    summary: "Update note tracking fields on an encounter",
    description:
      "Called by the RPA billing worker on every state transition (SEARCHING, FOUND_SIGNED, FOUND_UNSIGNED, NOT_FOUND). Accepts any subset of the tracking fields.",
  })
  @ApiParam({ name: "encounterId", type: "number" })
  @ApiResponse({ status: 200, description: "Encounter note tracking updated" })
  async updateEncounterNote(
    @Param("encounterId", ParseIntPipe) encounterId: number,
    @Body()
    body: {
      noteStatus?:
        | "PENDING"
        | "SEARCHING"
        | "NOT_FOUND"
        | "FOUND_UNSIGNED"
        | "FOUND_SIGNED";
      providerNote?: string | null;
      noteAttempts?: number;
      noteLastAttemptAt?: string;
      noteAgentSummary?: string;
    },
  ) {
    return this.rpaService.updateEncounterNote(encounterId, body);
  }

  @Get(":uuid/encounters/pending-notes")
  @ApiOperation({
    summary: "Get encounters pending note search",
    description:
      "Returns encounters where providerNote is null and the deadline has not expired. Used by RPA to know which notes to search.",
  })
  @ApiParam({ name: "uuid", type: "string" })
  @ApiResponse({ status: 200, description: "List of pending encounters" })
  async getPendingNoteEncounters(@Param("uuid") uuid: string) {
    return this.rpaService.getPendingNoteEncounters(uuid);
  }

  @Get("encounters/billing-status")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Billing-materials status per encounter",
    description:
      "Diagnostic view: for each recent encounter, returns the state of chartId / faceSheet / providerNote plus the note tracking details (status, attempts, last attempt, agent summary).",
  })
  @ApiQuery({ name: "doctorId", required: false, type: "number" })
  @ApiQuery({
    name: "status",
    required: false,
    enum: [
      "PENDING",
      "SEARCHING",
      "NOT_FOUND",
      "FOUND_UNSIGNED",
      "FOUND_SIGNED",
    ],
  })
  @ApiQuery({ name: "attempts", required: false, type: "number" })
  @ApiQuery({ name: "limit", required: false, type: "number" })
  async getEncountersBillingStatus(
    @Query("doctorId") doctorId?: string,
    @Query("status")
    status?:
      | "PENDING"
      | "SEARCHING"
      | "NOT_FOUND"
      | "FOUND_UNSIGNED"
      | "FOUND_SIGNED",
    @Query("attempts") attempts?: string,
    @Query("limit") limit?: string,
  ) {
    return this.rpaService.getEncountersBillingStatus({
      doctorId: doctorId ? Number(doctorId) : undefined,
      status,
      attempts: attempts ? Number(attempts) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
