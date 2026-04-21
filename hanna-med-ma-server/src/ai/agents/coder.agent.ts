import { Injectable, Logger } from "@nestjs/common";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import {
	HumanMessage,
	SystemMessage,
	type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";
import { LangChainModelService } from "../langchain-model.service";
import { CoverageService } from "../../coverage/coverage.service";
import { getCoderPrompt } from "../prompts/coder.prompt";
import { currentTimeForDisplay } from "../../core/date.util";
import { PrismaService } from "../../core/prisma.service";

// Zod schema for the final JSON proposal. `finalize_coding` is the
// agent's exit door — when it calls this tool, we capture the payload
// and return it verbatim. This gives us a typed JSON output without
// relying on the model to stay in markdown/plain-text format.
const cptProposalSchema = z.object({
	code: z.string().describe("5-char CPT/HCPCS code, e.g., 11721"),
	modifiers: z
		.array(z.string())
		.default([])
		.describe("CPT modifiers, e.g., ['25'], or [] when none"),
	units: z
		.number()
		.int()
		.min(1)
		.default(1)
		.describe("Units billed; typically 1"),
	pos: z
		.string()
		.optional()
		.describe("Place of Service code, e.g., '11' office, '21' inpatient"),
	evidenceSpan: z
		.string()
		.describe("Verbatim quote from the note that justifies this code"),
	rationale: z
		.string()
		.describe("1–2 sentences explaining why this code was chosen"),
});

const icd10ProposalSchema = z.object({
	code: z.string().describe("ICD-10-CM code"),
	evidenceSpan: z.string().describe("Verbatim quote from the note"),
	rationale: z.string().describe("1–2 sentences"),
});

const finalSchema = z.object({
	primaryCpt: z.string().describe("The main CPT being billed"),
	cptProposals: z.array(cptProposalSchema).min(1),
	icd10Proposals: z
		.array(icd10ProposalSchema)
		.min(1)
		.describe("Ordered: primary diagnosis first"),
	ncciIssues: z
		.array(
			z.object({
				column1: z.string(),
				column2: z.string(),
				action: z.enum(["collapsed", "modifier-added", "kept-both"]),
				note: z.string(),
			}),
		)
		.default([]),
	mueIssues: z
		.array(
			z.object({
				cpt: z.string(),
				requestedUnits: z.number(),
				maxUnits: z.number(),
				action: z.enum(["reduced", "split", "kept"]),
				note: z.string(),
			}),
		)
		.default([]),
	lcdCitations: z
		.array(
			z.object({
				lcdId: z.string(),
				lcdTitle: z.string(),
				articleId: z.string().optional(),
				relevantExcerpt: z.string().describe("The paragraph that governs"),
			}),
		)
		.default([]),
	documentationGaps: z
		.array(
			z.object({
				forCode: z.string(),
				missingElement: z.string(),
				suggestedLanguage: z
					.string()
					.describe("Concrete wording the provider could add"),
			}),
		)
		.default([]),
	providerQuestions: z
		.array(z.string())
		.default([])
		.describe("Specific asks back to the provider"),
	auditRiskNotes: z
		.array(z.string())
		.default([])
		.describe("Anything that could trigger an audit or denial"),
	auditRiskScore: z
		.number()
		.int()
		.min(0)
		.max(100)
		.describe(
			"0-100 risk that this claim gets denied/audited. 0-25 = low (docs bulletproof), 26-60 = review (minor gaps), 61+ = risk (structural issues).",
		),
	riskBand: z
		.enum(["LOW", "REVIEW", "RISK"])
		.describe("Coarse band derived from auditRiskScore."),
	riskBreakdown: z
		.array(
			z.object({
				dimension: z.enum([
					"LCD compliance",
					"NCCI pairs",
					"MUE",
					"Specificity",
					"Documentation completeness",
				]),
				verdict: z.enum(["ok", "partial", "fail"]),
				note: z.string().optional(),
			}),
		)
		.default([])
		.describe("Five required dimensions matching the Defense panel rows."),
	summary: z
		.string()
		.describe("One-paragraph narrative Hajira can read"),
});

export type CoderProposal = z.infer<typeof finalSchema>;

export interface CoderInput {
	noteText: string;
	locality: string;
	contractorNumber: string;
	year?: number;
	/**
	 * Pre-loaded specialty from CodingService. `systemPrompt` is the
	 * delta appended to the base prompt; empty string when we know
	 * the specialty but no delta has been authored yet. `name` is
	 * used only for the header section of the base prompt.
	 */
	specialty?: { name: string; systemPrompt: string };
	pos?: string;
}

export interface CoderResult {
	proposal: CoderProposal | null;
	rawText: string;
	toolCalls: string[];
}

@Injectable()
export class CoderAgent {
	private readonly logger = new Logger(CoderAgent.name);

	constructor(
		private readonly modelService: LangChainModelService,
		private readonly coverage: CoverageService,
		private readonly prisma: PrismaService,
	) {}

	async run(input: CoderInput): Promise<CoderResult> {
		const year = input.year ?? new Date().getFullYear();
		const basePrompt = getCoderPrompt({
			locality: input.locality,
			contractorNumber: input.contractorNumber,
			year,
			specialty: input.specialty?.name,
			pos: input.pos,
			currentDate: currentTimeForDisplay(),
		});

		// Specialty delta is pre-loaded by CodingService from the
		// Specialty relation. No DB lookup here — keeps the agent
		// pure-ish and lets callers decide how to resolve specialty.
		const specialtyDelta = input.specialty?.systemPrompt?.trim() || "";

		// Two cache_control blocks so Anthropic's prompt cache (5-min
		// TTL) reuses the base prompt across ANY encounter and reuses
		// the specialty delta across encounters for the same specialty.
		// The note text itself goes through as a user message and is
		// NOT cached (every encounter is different).
		const systemMessage = new SystemMessage({
			content: [
				{
					type: "text",
					text: basePrompt,
					cache_control: { type: "ephemeral" },
				},
				...(specialtyDelta
					? [
							{
								type: "text",
								text: specialtyDelta,
								cache_control: { type: "ephemeral" },
							},
						]
					: []),
			],
		});

		let captured: CoderProposal | null = null;
		const toolCalls: string[] = [];

		const tools = [
			tool(
				async ({ query, k }) => {
					toolCalls.push("search_cpt_codes");
					const hits = await this.coverage.searchCpt(query, k ?? 8);
					return JSON.stringify(hits);
				},
				{
					name: "search_cpt_codes",
					description:
						"Semantic search over the CPT/HCPCS catalog. Pass a short clinical phrase describing what was done (e.g., 'debridement of 7 mycotic toenails'). Returns top-K candidates with descriptions + status.",
					schema: z.object({
						query: z.string(),
						k: z.number().int().min(1).max(20).optional(),
					}),
				},
			),
			tool(
				async ({ query, k, billableOnly }) => {
					toolCalls.push("search_icd10_codes");
					const hits = await this.coverage.searchIcd10(
						query,
						k ?? 8,
						billableOnly ?? true,
					);
					return JSON.stringify(hits);
				},
				{
					name: "search_icd10_codes",
					description:
						"Semantic search over the ICD-10-CM catalog. Pass a diagnosis description. Set billableOnly=false only if you need parent categories.",
					schema: z.object({
						query: z.string(),
						k: z.number().int().min(1).max(20).optional(),
						billableOnly: z.boolean().optional(),
					}),
				},
			),
			tool(
				async ({ query, k, contractorNumber }) => {
					toolCalls.push("search_lcd_chunks");
					const hits = await this.coverage.searchLcdChunks(
						query,
						k ?? 5,
						contractorNumber,
					);
					return JSON.stringify(hits);
				},
				{
					name: "search_lcd_chunks",
					description:
						"Semantic search over chunked LCD + Article text. Pass a clinical phrase. Returns governing paragraphs. Pass contractorNumber='09102' to filter to First Coast FL.",
					schema: z.object({
						query: z.string(),
						k: z.number().int().min(1).max(10).optional(),
						contractorNumber: z.string().optional(),
					}),
				},
			),
			tool(
				async ({ query, k }) => {
					toolCalls.push("search_coding_guidelines");
					const hits = await this.coverage.searchCodingGuidelines(
						query,
						k ?? 5,
					);
					return JSON.stringify(hits);
				},
				{
					name: "search_coding_guidelines",
					description:
						"Search the ICD-10-CM Official Guidelines for Coding and Reporting (FY2026). Use this when you need authoritative guidance on combination codes, sequencing rules, 'code first' / 'use additional code' mandates, or any specificity question. Returns the actual paragraph from the CMS guidelines document, tagged with its section number (e.g. 'I.C.4.a.2').",
					schema: z.object({
						query: z.string(),
						k: z.number().int().min(1).max(10).optional(),
					}),
				},
			),
			tool(
				async ({ cpt, locality, year, modifier }) => {
					toolCalls.push("get_fee_schedule");
					try {
						return JSON.stringify(
							await this.coverage.findFee({
								cpt,
								locality: locality ?? input.locality,
								year: year ?? (input.year ?? new Date().getFullYear()),
								modifier,
							}),
						);
					} catch (e: unknown) {
						return JSON.stringify({
							error: (e as Error).message,
						});
					}
				},
				{
					name: "get_fee_schedule",
					description:
						"Look up the localized Medicare payment for a CPT+modifier. Also returns status code (A=active, I=invalid).",
					schema: z.object({
						cpt: z.string(),
						locality: z.string().optional(),
						year: z.number().int().optional(),
						modifier: z.string().optional(),
					}),
				},
			),
			tool(
				async ({ cpt1, cpt2 }) => {
					toolCalls.push("check_ncci_bundle");
					return JSON.stringify(await this.coverage.checkNcciPair(cpt1, cpt2));
				},
				{
					name: "check_ncci_bundle",
					description:
						"Check if two CPTs bundle per NCCI PTP. Returns modifierIndicator (0=never, 1=bypassable with modifier, 9=N/A) and rationale.",
					schema: z.object({ cpt1: z.string(), cpt2: z.string() }),
				},
			),
			tool(
				async ({ cpt, serviceType }) => {
					toolCalls.push("check_mue_limit");
					const lim = await this.coverage.getMueLimit(
						cpt,
						serviceType ?? "PRACTITIONER",
					);
					return JSON.stringify(
						lim ?? { note: `No MUE on file for ${cpt}.` },
					);
				},
				{
					name: "check_mue_limit",
					description:
						"Fetch the Medically Unlikely Edit (max units/day) for a CPT. Default service type PRACTITIONER.",
					schema: z.object({
						cpt: z.string(),
						serviceType: z
							.enum(["PRACTITIONER", "OUTPATIENT", "DME"])
							.optional(),
					}),
				},
			),
			tool(
				async ({ cpt, contractorNumber }) => {
					toolCalls.push("get_lcds_for_cpt");
					return JSON.stringify(
						await this.coverage.getLcdsForCpt(
							cpt,
							contractorNumber ?? input.contractorNumber,
						),
					);
				},
				{
					name: "get_lcds_for_cpt",
					description:
						"Return every LCD (via its companion Article) that governs this CPT in the given MAC jurisdiction.",
					schema: z.object({
						cpt: z.string(),
						contractorNumber: z.string().optional(),
					}),
				},
			),
			tool(
				async (payload) => {
					toolCalls.push("finalize_coding");
					captured = payload as CoderProposal;
					return "Proposal captured.";
				},
				{
					name: "finalize_coding",
					description:
						"Submit the FINAL structured proposal. Call this ONCE when you've gathered enough evidence.",
					schema: finalSchema,
				},
			),
		];

		const agent = createReactAgent({
			llm: this.modelService.getCoderModel(),
			tools,
			// Function form so we can prepend our structured SystemMessage
			// (with cache_control blocks) instead of letting langgraph
			// convert a plain string — otherwise caching is lost.
			prompt: (state: { messages: BaseMessage[] }) => [
				systemMessage,
				...state.messages,
			],
		});

		this.logger.log(`CoderAgent run — ${input.noteText.length} chars of note`);

		let rawText = "";
		try {
			const stream = await agent.stream(
				{ messages: [new HumanMessage(input.noteText)] },
				{
					streamMode: "messages",
					// Typical run: ~1 search_cpt + N search_icd10 + 3×N tool
					// calls per CPT (fee, mue, lcds) + finalize. Easily 30–40
					// steps for a multi-procedure encounter.
					recursionLimit: 60,
				},
			);
			for await (const item of stream as AsyncIterable<unknown>) {
				const [message, metadata] = Array.isArray(item)
					? (item as [unknown, { langgraph_node?: string }])
					: [item, {}];
				const chunk = message as {
					content?: unknown;
					text?: string;
					tool_calls?: Array<{ name?: string }>;
				};
				const nodeType = metadata?.langgraph_node || "unknown";
				if (nodeType === "agent") {
					if (typeof chunk.content === "string") rawText += chunk.content;
					else if (Array.isArray(chunk.content)) {
						rawText += chunk.content
							.filter(
								(p: unknown): p is string | { type: string; text?: string } =>
									typeof p === "string" ||
									(typeof p === "object" &&
										p !== null &&
										(p as { type?: string }).type === "text"),
							)
							.map((p) =>
								typeof p === "string"
									? p
									: (p as { text?: string }).text || "",
							)
							.join("");
					}
				}
			}
		} catch (e: unknown) {
			this.logger.error(
				`CoderAgent error: ${(e as Error).message}`,
				(e as Error).stack,
			);
			throw e;
		}

		this.logger.log(
			`CoderAgent done — ${toolCalls.length} tool calls (${new Set(toolCalls).size} distinct), proposal=${captured ? "yes" : "NO"}`,
		);

		return { proposal: captured, rawText: rawText.trim(), toolCalls };
	}
}
