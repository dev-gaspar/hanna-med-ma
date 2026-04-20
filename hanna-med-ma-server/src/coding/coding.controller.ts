import {
	Body,
	Controller,
	Post,
	UseGuards,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiBody,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CoderAgent } from "../ai/agents/coder.agent";

@ApiTags("Coding")
@Controller("coding")
export class CodingController {
	constructor(private readonly coder: CoderAgent) {}

	@Post("propose")
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({
		summary:
			"AI Coder: given a clinical note, return a structured CPT/ICD-10 proposal with evidence, validation, and gaps.",
	})
	@ApiBody({
		schema: {
			type: "object",
			required: ["noteText"],
			properties: {
				noteText: { type: "string", description: "Full signed clinical note" },
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
		const result = await this.coder.run({
			noteText: body.noteText,
			locality: body.locality || "04",
			contractorNumber: body.contractorNumber || "09102",
			year: body.year,
			specialty: body.specialty,
			pos: body.pos,
		});
		return {
			proposal: result.proposal,
			toolCalls: result.toolCalls,
			// rawText is only useful when the agent fails to call finalize_coding.
			rawText: result.proposal ? undefined : result.rawText,
		};
	}
}
