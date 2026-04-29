import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CoderAgent } from "../ai/agents/coder.agent";
import { CodingService } from "./coding.service";

@ApiTags("Coding")
@Controller("coding")
export class CodingController {
  constructor(
    private readonly coder: CoderAgent,
    private readonly coding: CodingService,
  ) {}

  // Raw, stateless coding from a free-text note (debug / demo).
  // UI should not use this — use the encounter-scoped endpoints below.
  @Post("propose")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "[Debug] Stateless coding: given a raw clinical note, return a proposal with no persistence.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["noteText", "locality", "contractorNumber", "pos"],
      properties: {
        noteText: { type: "string" },
        locality: { type: "string", example: "04" },
        contractorNumber: { type: "string", example: "09102" },
        year: { type: "number", example: 2026 },
        specialty: { type: "string", example: "Podiatry" },
        pos: { type: "string", example: "11" },
      },
    },
  })
  async propose(
    @Body()
    body: {
      noteText: string;
      locality: string;
      contractorNumber: string;
      year?: number;
      specialty?: string;
      pos: string;
    },
  ) {
    // Debug endpoint: caller must provide locality, contractor and
    // POS explicitly. We refuse to default them — silently picking
    // Hanna-Med values would let a debug call from a different
    // jurisdiction return prices that look plausible but are wrong.
    if (!body.locality || !body.contractorNumber || !body.pos) {
      throw new BadRequestException(
        "locality, contractorNumber and pos are required — pass them explicitly so the debug result is unambiguous.",
      );
    }
    const result = await this.coder.run({
      noteText: body.noteText,
      locality: body.locality,
      contractorNumber: body.contractorNumber,
      year: body.year,
      specialty: body.specialty
        ? { name: body.specialty, systemPrompt: "" }
        : undefined,
      pos: body.pos,
    });
    return {
      proposal: result.proposal,
      toolCalls: result.toolCalls,
      rawText: result.proposal ? undefined : result.rawText,
    };
  }

  @Get("inbox")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "Doctor's coding inbox — every encounter with a signed note, paired with its latest AI coding (or null). Sorted by risk.",
  })
  async getInbox(
    @Request() req: { user: { userId: number } },
    @Query("status") status?: string,
    @Query("riskBand") riskBand?: string,
    @Query("emrSystem") emrSystem?: string,
    @Query("search") search?: string,
  ) {
    return this.coding.getInbox(req.user.userId, {
      status,
      riskBand,
      emrSystem,
      search,
    });
  }

  @Get("encounters/:encounterId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "Latest AI coding proposal for an encounter. Returns null if none has been generated yet.",
  })
  @ApiParam({ name: "encounterId", type: "number" })
  async getLatest(@Param("encounterId", ParseIntPipe) encounterId: number) {
    const coding = await this.coding.getLatestForEncounter(encounterId);
    return coding ?? null;
  }

  @Get("encounters/:encounterId/history")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "All coding passes for an encounter (newest first)",
  })
  async getHistory(@Param("encounterId", ParseIntPipe) encounterId: number) {
    return this.coding.listForEncounter(encounterId);
  }

  @Post("encounters/:encounterId/generate")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      "Kick off an AI Coder run against this encounter's signed note. Returns 202 immediately with the new coding id; the UI polls GET /coding/encounters/:id for progress + terminal state.",
  })
  async generate(@Param("encounterId", ParseIntPipe) encounterId: number) {
    return this.coding.enqueueGeneration(encounterId);
  }

  @Patch("proposals/:id/approve")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "Sign-off: mark a coding DRAFT/UNDER_REVIEW as APPROVED. Records the approving doctor.",
  })
  @ApiParam({ name: "id", type: "number" })
  async approve(
    @Param("id", ParseIntPipe) id: number,
    @Request() req: { user: { userId: number } },
  ) {
    const coding = await this.coding.approve(id, req.user.userId);
    if (!coding) throw new NotFoundException(`Coding ${id} not found`);
    return coding;
  }

  @Patch("proposals/:id/transferred")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "Mark APPROVED coding as TRANSFERRED_TO_CARETRACKER (Hajira finished tipéing it).",
  })
  async markTransferred(@Param("id", ParseIntPipe) id: number) {
    return this.coding.markTransferred(id);
  }
}
