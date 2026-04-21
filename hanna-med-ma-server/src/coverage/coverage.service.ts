import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { PrismaService } from "../core/prisma.service";

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 768;

function toVectorLiteral(vec: number[]): string {
	return "[" + vec.map((v) => v.toFixed(6)).join(",") + "]";
}

/**
 * Regulatory-engine service. Wraps the five loaded books (MPFS,
 * NCCI, MUE, LCDs + Articles) and the vector layer built on top of
 * them. The AI Coder calls the methods here through LangChain tool
 * wrappers — every method returns plain JSON-serialisable data.
 */
@Injectable()
export class CoverageService {
	private readonly logger = new Logger(CoverageService.name);
	private readonly ai: GoogleGenAI;

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {
		const apiKey = this.configService.get<string>("SERVER_GEMINI_API_KEY") || "";
		this.ai = new GoogleGenAI({ apiKey });
	}

	// ─── MPFS lookup ──────────────────────────────────────────────────────

	/**
	 * Resolve the localized MPFS payment for a CPT in a given locality/year.
	 * `modifier` is optional — when provided we try the exact modifier first
	 * and fall back to the unmodified row so callers can pass e.g. "26"
	 * without having to know up front whether a 26-specific row exists.
	 */
	async findFee(params: {
		cpt: string;
		locality: string;
		state?: string;
		year: number;
		modifier?: string;
	}) {
		const { cpt, locality, year } = params;
		const state = (params.state || "FL").toUpperCase();
		const modifier = params.modifier || "";

		const loc = await this.prisma.locality.findUnique({
			where: { code_state_year: { code: locality, state, year } },
		});
		if (!loc) {
			throw new NotFoundException(
				`Locality ${state}-${locality} for ${year} not loaded`,
			);
		}

		const row =
			(await this.prisma.feeScheduleItem.findUnique({
				where: {
					cpt_modifier_localityId_year: {
						cpt,
						modifier,
						localityId: loc.id,
						year,
					},
				},
			})) ||
			(modifier === ""
				? null
				: await this.prisma.feeScheduleItem.findUnique({
						where: {
							cpt_modifier_localityId_year: {
								cpt,
								modifier: "",
								localityId: loc.id,
								year,
							},
						},
					}));

		if (!row) {
			throw new NotFoundException(
				`No MPFS row for CPT ${cpt}${modifier ? `-${modifier}` : ""} at ${state}-${locality} (${year})`,
			);
		}

		return {
			cpt: row.cpt,
			modifier: row.modifier,
			year: row.year,
			description: row.description,
			locality: {
				code: loc.code,
				state: loc.state,
				description: loc.description,
				macContractor: loc.macContractor,
				gpci: {
					work: loc.workGpci,
					pe: loc.peGpci,
					mp: loc.mpGpci,
				},
			},
			rvu: {
				work: row.workRvu,
				pe: row.peRvu,
				peFacility: row.peFacilityRvu,
				mp: row.mpRvu,
			},
			conversionFactor: row.conversionFactor,
			amount: {
				nonFacility: row.amountUsd,
				facility: row.amountFacilityUsd,
			},
			globalDays: row.globalDays,
			statusCode: row.statusCode,
		};
	}

	// ─── Embedding helper ─────────────────────────────────────────────────

	// RETRIEVAL_QUERY is the asymmetric partner of the RETRIEVAL_DOCUMENT
	// embeddings stored at ingest — same vector space, tuned for the
	// "user query → corpus" direction.
	private async embedQuery(text: string): Promise<number[]> {
		const res = await this.ai.models.embedContent({
			model: EMBED_MODEL,
			contents: text,
			config: {
				outputDimensionality: EMBED_DIM,
				taskType: "RETRIEVAL_QUERY",
			},
		});
		const vec = res.embeddings?.[0]?.values;
		if (!vec || vec.length === 0) {
			throw new Error("Gemini returned empty embedding");
		}
		return vec;
	}

	// ─── Vector search ────────────────────────────────────────────────────

	async searchCpt(
		query: string,
		k = 10,
	): Promise<
		Array<{
			code: string;
			description: string;
			longDescription: string | null;
			statusCode: string | null;
			similarity: number;
		}>
	> {
		const lit = toVectorLiteral(await this.embedQuery(query));
		const rows = await this.prisma.$queryRawUnsafe<
			Array<{
				code: string;
				description: string;
				longDescription: string | null;
				statusCode: string | null;
				similarity: number;
			}>
		>(
			`SELECT code, description, "longDescription", "statusCode",
			        1 - (embedding <=> $1::vector) AS similarity
			 FROM cpt_codes
			 WHERE embedding IS NOT NULL
			 ORDER BY embedding <=> $1::vector
			 LIMIT ${Math.min(Math.max(k, 1), 50)}`,
			lit,
		);
		return rows.map((r) => ({
			...r,
			similarity: Number(r.similarity),
		}));
	}

	async searchIcd10(
		query: string,
		k = 10,
		billableOnly = true,
	): Promise<
		Array<{
			code: string;
			longDescription: string;
			shortDescription: string;
			isBillable: boolean;
			similarity: number;
		}>
	> {
		const lit = toVectorLiteral(await this.embedQuery(query));
		const filter = billableOnly
			? `AND "isBillable" = true`
			: "";
		const rows = await this.prisma.$queryRawUnsafe<
			Array<{
				code: string;
				longDescription: string;
				shortDescription: string;
				isBillable: boolean;
				similarity: number;
			}>
		>(
			`SELECT code, "longDescription", "shortDescription", "isBillable",
			        1 - (embedding <=> $1::vector) AS similarity
			 FROM icd10_codes
			 WHERE embedding IS NOT NULL ${filter}
			 ORDER BY embedding <=> $1::vector
			 LIMIT ${Math.min(Math.max(k, 1), 50)}`,
			lit,
		);
		return rows.map((r) => ({
			...r,
			similarity: Number(r.similarity),
		}));
	}

	async searchCodingGuidelines(
		query: string,
		k = 5,
	): Promise<
		Array<{
			section: string;
			heading: string | null;
			chunkIndex: number;
			sourceYear: number;
			text: string;
			similarity: number;
		}>
	> {
		const lit = toVectorLiteral(await this.embedQuery(query));
		const rows = await this.prisma.$queryRawUnsafe<
			Array<{
				section: string;
				heading: string | null;
				chunkIndex: number;
				sourceYear: number;
				text: string;
				similarity: number;
			}>
		>(
			`SELECT section, heading, "chunkIndex", "sourceYear", text,
			        1 - (embedding <=> $1::vector) AS similarity
			 FROM coding_guidelines
			 WHERE embedding IS NOT NULL
			 ORDER BY embedding <=> $1::vector
			 LIMIT ${Math.min(Math.max(k, 1), 20)}`,
			lit,
		);
		return rows.map((r) => ({
			...r,
			chunkIndex: Number(r.chunkIndex),
			sourceYear: Number(r.sourceYear),
			similarity: Number(r.similarity),
		}));
	}

	async searchLcdChunks(
		query: string,
		k = 6,
		contractorNumber?: string,
	): Promise<
		Array<{
			kind: "LCD" | "ARTICLE";
			docId: string;
			docTitle: string;
			section: string;
			chunkIndex: number;
			text: string;
			similarity: number;
		}>
	> {
		const lit = toVectorLiteral(await this.embedQuery(query));

		// Contractor filter is applied via the lcd_contractors /
		// lcd_article_contractors join — keeps us inside one MAC's
		// jurisdiction (e.g., '09102' = FCSO Part B FL).
		const contractorFilter = contractorNumber
			? `AND (
			     (c."lcdId" IS NOT NULL AND EXISTS (
			       SELECT 1 FROM lcd_contractors lc
			       WHERE lc."lcdId" = c."lcdId" AND lc."contractorNumber" = $2
			     ))
			     OR
			     (c."articleId" IS NOT NULL AND EXISTS (
			       SELECT 1 FROM lcd_article_contractors ac
			       WHERE ac."articleId" = c."articleId" AND ac."contractorNumber" = $2
			     ))
			   )`
			: "";

		const params: unknown[] = [lit];
		if (contractorNumber) params.push(contractorNumber);

		const rows = await this.prisma.$queryRawUnsafe<
			Array<{
				kind: "LCD" | "ARTICLE";
				docId: string;
				docTitle: string;
				section: string;
				chunkIndex: number;
				text: string;
				similarity: number;
			}>
		>(
			`SELECT
			   CASE WHEN c."lcdId" IS NOT NULL THEN 'LCD' ELSE 'ARTICLE' END AS kind,
			   COALESCE(l."lcdId", a."articleId") AS "docId",
			   COALESCE(l.title, a.title) AS "docTitle",
			   c.section, c."chunkIndex", c.text,
			   1 - (c.embedding <=> $1::vector) AS similarity
			 FROM lcd_text_chunks c
			 LEFT JOIN lcds         l ON l.id = c."lcdId"
			 LEFT JOIN lcd_articles a ON a.id = c."articleId"
			 WHERE c.embedding IS NOT NULL
			 ${contractorFilter}
			 ORDER BY c.embedding <=> $1::vector
			 LIMIT ${Math.min(Math.max(k, 1), 20)}`,
			...params,
		);
		return rows.map((r) => ({
			...r,
			chunkIndex: Number(r.chunkIndex),
			similarity: Number(r.similarity),
		}));
	}

	// ─── Regulatory validation ────────────────────────────────────────────

	// NCCI PTP: is (cpt1, cpt2) a currently-enforced bundling edit?
	// `deletionDate IS NULL` = still live in the quarterly release.
	// Returns the FIRST active edit found in either direction
	// (practitioner or hospital), or null if no bundling applies.
	async checkNcciPair(cpt1: string, cpt2: string) {
		const edit = await this.prisma.ncciEdit.findFirst({
			where: {
				deletionDate: null,
				OR: [
					{ column1Cpt: cpt1, column2Cpt: cpt2 },
					{ column1Cpt: cpt2, column2Cpt: cpt1 },
				],
			},
			orderBy: { effectiveDate: "desc" },
		});
		if (!edit) {
			return { bundled: false as const };
		}
		return {
			bundled: true as const,
			column1Cpt: edit.column1Cpt,
			column2Cpt: edit.column2Cpt,
			modifierIndicator: edit.modifierIndicator,
			modifierMeaning:
				edit.modifierIndicator === "0"
					? "never bypassable — the pair must be collapsed to a single code"
					: edit.modifierIndicator === "1"
						? "bypassable with an appropriate NCCI-associated modifier (59/XE/XP/XS/XU)"
						: "not applicable",
			rationale: edit.rationale,
			effectiveDate: edit.effectiveDate,
			editType: edit.editType,
		};
	}

	// MUE: max units of a CPT in a single day for a single beneficiary.
	async getMueLimit(
		cpt: string,
		serviceType: "PRACTITIONER" | "OUTPATIENT" | "DME" = "PRACTITIONER",
	) {
		const row = await this.prisma.mueLimit.findFirst({
			where: { cpt, serviceType },
			orderBy: { effectiveDate: "desc" },
		});
		if (!row) return null;
		return {
			cpt: row.cpt,
			maxUnitsPerDay: row.mueValue,
			mai: row.mai,
			adjudicationIndicator: row.adjudicationIndicator,
			rationale: row.rationale,
			serviceType: row.serviceType,
			effectiveDate: row.effectiveDate,
		};
	}

	// Every LCD (via its companion Article) that references a given CPT.
	// Narrowed to a contractor when we know the patient's jurisdiction.
	async getLcdsForCpt(cpt: string, contractorNumber?: string) {
		const articles = await this.prisma.lcdArticleCpt.findMany({
			where: { cpt },
			include: {
				article: {
					include: {
						contractors: contractorNumber
							? { where: { contractorNumber } }
							: true,
						lcdLinks: { include: { lcd: true } },
					},
				},
			},
			take: 20,
		});

		// Flatten to (lcd, article) pairs filtered by contractor if requested.
		const out: Array<{
			lcdId: string;
			lcdTitle: string;
			lcdStatus: string | null;
			articleId: string;
			articleTitle: string;
			contractorMatches: string[];
		}> = [];
		for (const ac of articles) {
			const art = ac.article;
			if (contractorNumber && art.contractors.length === 0) continue;
			for (const link of art.lcdLinks) {
				out.push({
					lcdId: link.lcd.lcdId,
					lcdTitle: link.lcd.title,
					lcdStatus: link.lcd.status,
					articleId: art.articleId,
					articleTitle: art.title,
					contractorMatches: art.contractors.map((c) => c.contractorNumber),
				});
			}
		}
		// Dedup on (lcdId, articleId) — an article can link the same LCD twice.
		const seen = new Set<string>();
		return out.filter((r) => {
			const k = `${r.lcdId}|${r.articleId}`;
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	}

	// ─── CPT / ICD description lookup ──────────────────────────────────
	// Both tables have an Unsupported("vector(768)") embedding column
	// but Prisma's typed client still handles the non-vector fields —
	// it just excludes `embedding` from the generated types, which is
	// exactly what we want (the vector lives behind the search_* paths).

	async getCptInfo(cpt: string) {
		return this.prisma.cptCode.findUnique({
			where: { code: cpt },
			select: {
				code: true,
				description: true,
				longDescription: true,
				statusCode: true,
			},
		});
	}

	async getIcd10Info(code: string) {
		return this.prisma.icd10Code.findUnique({
			where: { code },
			select: {
				code: true,
				shortDescription: true,
				longDescription: true,
				isBillable: true,
			},
		});
	}
}
