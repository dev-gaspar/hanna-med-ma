import {
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	ParseIntPipe,
	Patch,
	Post,
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
			required: ["noteText"],
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
			locality?: string;
			contractorNumber?: string;
			year?: number;
			specialty?: string;
			pos?: string;
		},
	) {
		// Debug endpoint: caller only provides the specialty name, so
		// the delta is left empty. For the persisted path (encounters/
		// :id/generate) the delta comes from the Specialty relation.
		const result = await this.coder.run({
			noteText: body.noteText,
			locality: body.locality || "04",
			contractorNumber: body.contractorNumber || "09102",
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

	@Get("encounters/:encounterId")
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({
		summary:
			"Latest AI coding proposal for an encounter. Returns null if none has been generated yet.",
	})
	@ApiParam({ name: "encounterId", type: "number" })
	async getLatest(
		@Param("encounterId", ParseIntPipe) encounterId: number,
	) {
		const coding = await this.coding.getLatestForEncounter(encounterId);
		return coding ?? null;
	}

	@Get("encounters/:encounterId/history")
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({
		summary: "All coding passes for an encounter (newest first)",
	})
	async getHistory(
		@Param("encounterId", ParseIntPipe) encounterId: number,
	) {
		return this.coding.listForEncounter(encounterId);
	}

	@Post("encounters/:encounterId/generate")
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({
		summary:
			"Run the AI Coder against this encounter's signed note and persist a DRAFT proposal. Each call creates a new pass.",
	})
	async generate(
		@Param("encounterId", ParseIntPipe) encounterId: number,
	) {
		return this.coding.generateForEncounter(encounterId);
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
