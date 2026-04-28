import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import { PrismaService } from "../core/prisma.service";

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 768;

// HNSW's default ef_search of 40 gives poor recall on our 98k-row
// icd10_codes index — densely-clustered rivals (L97 ulcer family)
// consistently mask the correct diabetes-with-ulcer combination
// codes (E11.62x, E08.62x, ...). Bumping to 200 restores recall
// while keeping per-query latency under 5ms. Applied per-query via
// `SET LOCAL` inside a transaction so it never leaks to other
// connections in the pool.
const HNSW_EF_SEARCH = 200;

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
    const apiKey =
      this.configService.get<string>("SERVER_GEMINI_API_KEY") || "";
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

  /**
   * Run a vector similarity query with an elevated `hnsw.ef_search`
   * so approximate-nearest-neighbor recall stays high. SET LOCAL only
   * affects the current transaction, so this can't leak to other
   * connections in the pool.
   *
   * The 30s `timeout` overrides Prisma's 5s interactive-transaction
   * default. Under concurrent batch-validate runs (multiple parallel
   * coder agents each issuing search_* calls), the default has
   * occasionally tripped: "Transaction already closed: 5815 ms passed
   * since the start of the transaction." 30s is generous — pgvector
   * with HNSW ef_search=200 typically returns under 200ms; the slack
   * absorbs cold-cache spikes and connection-pool contention without
   * masking real query regressions.
   */
  private async vectorQuery<T>(sql: string, ...params: unknown[]): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`,
        );
        return tx.$queryRawUnsafe<T>(sql, ...params);
      },
      { timeout: 30_000 },
    );
  }

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
    const rows = await this.vectorQuery<
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
    const filter = billableOnly ? `AND "isBillable" = true` : "";
    const rows = await this.vectorQuery<
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
    const rows = await this.vectorQuery<
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

  async searchPolicyRules(
    query: string,
    k = 5,
    kinds?: Array<
      "CMS_CLAIMS_MANUAL" | "NCCI_POLICY_MANUAL" | "GLOBAL_SURGERY_BOOKLET"
    >,
  ): Promise<
    Array<{
      kind: string;
      citation: string;
      chapter: string | null;
      section: string | null;
      heading: string | null;
      chunkIndex: number;
      text: string;
      sourceUrl: string | null;
      sourceVersion: string | null;
      similarity: number;
    }>
  > {
    const lit = toVectorLiteral(await this.embedQuery(query));

    // Parameterize the kind filter so Postgres caches the plan —
    // using `ANY($2::"PolicyDocKind"[])` lets callers pass 0-3 kinds
    // in one query without branching the SQL shape.
    const kindFilter =
      kinds && kinds.length > 0 ? `AND kind = ANY($2::"PolicyDocKind"[])` : "";
    const params: unknown[] = [lit];
    if (kinds && kinds.length > 0) params.push(kinds);

    const rows = await this.vectorQuery<
      Array<{
        kind: string;
        citation: string;
        chapter: string | null;
        section: string | null;
        heading: string | null;
        chunkIndex: number;
        text: string;
        sourceUrl: string | null;
        sourceVersion: string | null;
        similarity: number;
      }>
    >(
      `SELECT kind::text AS kind, citation, chapter, section, heading,
              "chunkIndex", text, "sourceUrl", "sourceVersion",
              1 - (embedding <=> $1::vector) AS similarity
         FROM policy_rules
         WHERE embedding IS NOT NULL
         ${kindFilter}
         ORDER BY embedding <=> $1::vector
         LIMIT ${Math.min(Math.max(k, 1), 20)}`,
      ...params,
    );
    return rows.map((r) => ({
      ...r,
      chunkIndex: Number(r.chunkIndex),
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

    const rows = await this.vectorQuery<
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

  // ─── Payer E/M family rule lookup ─────────────────────────────────
  /**
   * Resolve which E/M family a payer requires for inpatient consults.
   *
   * Resolution order:
   *   1. Practice-specific exact match (payerName + practiceId, age in range)
   *   2. Practice-specific regex match (payerPattern + practiceId, age in range)
   *   3. Global default exact match (payerName + practiceId IS NULL)
   *   4. Global default regex match (payerPattern + practiceId IS NULL)
   *   5. DEPENDS_HUMAN_REVIEW fallback
   *
   * Self-Pay age cutoff is encoded as two rows for the same payerName
   * (one with ageMax=64, one with ageMin=65). The age filter selects
   * the right one. When `patientAge` is null/undefined, we prefer the
   * row with no age bounds, then DEPENDS as fallback.
   */
  async lookupPayerRule(params: {
    payerName: string;
    patientAge?: number | null;
    practiceId?: number | null;
  }): Promise<{
    matched: boolean;
    matchType:
      | "PRACTICE_EXACT"
      | "PRACTICE_CONTAINS"
      | "PRACTICE_PATTERN"
      | "GLOBAL_EXACT"
      | "GLOBAL_CONTAINS"
      | "GLOBAL_PATTERN"
      | "FALLBACK_DEPENDS";
    ruleId: number | null;
    payerName: string;
    category: "ALWAYS_INITIAL_HOSPITAL" | "ALWAYS_CONSULT" | "DEPENDS_HUMAN_REVIEW";
    consultCodeFamilyEligible: boolean;
    eligibleFamily: "99221-99223" | "99253-99255" | "DEPENDS";
    ageRange: { min: number | null; max: number | null } | null;
    notes: string | null;
    source: string | null;
    rationale: string;
  }> {
    const { payerName, patientAge, practiceId } = params;
    const ageInRange = (
      ageMin: number | null,
      ageMax: number | null,
    ): boolean => {
      if (patientAge == null) return ageMin == null && ageMax == null;
      if (ageMin != null && patientAge < ageMin) return false;
      if (ageMax != null && patientAge > ageMax) return false;
      return true;
    };

    const eligibleFamily = (
      cat: "ALWAYS_INITIAL_HOSPITAL" | "ALWAYS_CONSULT" | "DEPENDS_HUMAN_REVIEW",
    ) =>
      cat === "ALWAYS_CONSULT"
        ? ("99253-99255" as const)
        : cat === "ALWAYS_INITIAL_HOSPITAL"
          ? ("99221-99223" as const)
          : ("DEPENDS" as const);

    const buildResult = (
      rule: {
        id: number;
        payerName: string;
        category: "ALWAYS_INITIAL_HOSPITAL" | "ALWAYS_CONSULT" | "DEPENDS_HUMAN_REVIEW";
        ageMin: number | null;
        ageMax: number | null;
        notes: string | null;
        source: string | null;
      },
      matchType:
        | "PRACTICE_EXACT"
        | "PRACTICE_CONTAINS"
        | "PRACTICE_PATTERN"
        | "GLOBAL_EXACT"
        | "GLOBAL_CONTAINS"
        | "GLOBAL_PATTERN",
    ) => ({
      matched: true,
      matchType,
      ruleId: rule.id,
      payerName: rule.payerName,
      category: rule.category,
      consultCodeFamilyEligible: rule.category === "ALWAYS_CONSULT",
      eligibleFamily: eligibleFamily(rule.category),
      ageRange: { min: rule.ageMin, max: rule.ageMax },
      notes: rule.notes,
      source: rule.source,
      rationale: `Matched via ${matchType.toLowerCase().replace("_", " ")} on PayerEMRule#${rule.id} (${rule.payerName}). ${rule.notes ?? ""}`.trim(),
    });

    // Specificity-first ordering for tie-breaks: rules with at least
    // one explicit age bound (ageMin OR ageMax) outrank rules with no
    // age constraint at all. Without this, a payer with both a "<65 →
    // ALWAYS_CONSULT" row AND a "no-age catch-all → DEPENDS" row would
    // always match the catch-all first because both pass `ageInRange`
    // when the patient is e.g. 38. Sort once and reuse for every step.
    const sortBySpecificity = <
      T extends { ageMin: number | null; ageMax: number | null },
    >(
      rules: T[],
    ): T[] =>
      [...rules].sort((a, b) => {
        const aSpec = (a.ageMin != null ? 1 : 0) + (a.ageMax != null ? 1 : 0);
        const bSpec = (b.ageMin != null ? 1 : 0) + (b.ageMax != null ? 1 : 0);
        return bSpec - aSpec;
      });

    // Step 1: practice-specific exact name match (case-insensitive contains
    // both directions to handle slight phrasing differences).
    if (practiceId != null) {
      const practiceRules = sortBySpecificity(
        await this.prisma.payerEMRule.findMany({
          where: { practiceId },
        }),
      );
      const lowerName = payerName.toLowerCase();
      // Exact-name first
      for (const r of practiceRules) {
        if (
          r.payerName.toLowerCase() === lowerName &&
          ageInRange(r.ageMin, r.ageMax)
        ) {
          return buildResult(r, "PRACTICE_EXACT");
        }
      }
      // Then containment (face sheet often has more text than the canonical
      // payer name): "BCBS PPC/PPS/PHS" contains "BCBS PPC" etc.
      for (const r of practiceRules) {
        if (
          (lowerName.includes(r.payerName.toLowerCase()) ||
            r.payerName.toLowerCase().includes(lowerName)) &&
          ageInRange(r.ageMin, r.ageMax)
        ) {
          return buildResult(r, "PRACTICE_CONTAINS");
        }
      }
      // Pattern (regex) match
      for (const r of practiceRules) {
        if (!r.payerPattern) continue;
        try {
          const re = new RegExp(r.payerPattern);
          if (re.test(payerName) && ageInRange(r.ageMin, r.ageMax)) {
            return buildResult(r, "PRACTICE_PATTERN");
          }
        } catch {
          // Invalid regex — skip and log.
          this.logger.warn(
            `Invalid payerPattern regex on PayerEMRule#${r.id}: ${r.payerPattern}`,
          );
        }
      }
    }

    // Step 2: global default (practiceId IS NULL)
    const globalRules = sortBySpecificity(
      await this.prisma.payerEMRule.findMany({
        where: { practiceId: null },
      }),
    );
    const lowerName = payerName.toLowerCase();
    for (const r of globalRules) {
      if (
        r.payerName.toLowerCase() === lowerName &&
        ageInRange(r.ageMin, r.ageMax)
      ) {
        return buildResult(r, "GLOBAL_EXACT");
      }
    }
    for (const r of globalRules) {
      if (
        (lowerName.includes(r.payerName.toLowerCase()) ||
          r.payerName.toLowerCase().includes(lowerName)) &&
        ageInRange(r.ageMin, r.ageMax)
      ) {
        return buildResult(r, "GLOBAL_CONTAINS");
      }
    }
    for (const r of globalRules) {
      if (!r.payerPattern) continue;
      try {
        const re = new RegExp(r.payerPattern);
        if (re.test(payerName) && ageInRange(r.ageMin, r.ageMax)) {
          return buildResult(r, "GLOBAL_PATTERN");
        }
      } catch {
        // skip invalid regex
      }
    }

    // Step 3: fallback
    return {
      matched: false,
      matchType: "FALLBACK_DEPENDS",
      ruleId: null,
      payerName,
      category: "DEPENDS_HUMAN_REVIEW",
      consultCodeFamilyEligible: false,
      eligibleFamily: "DEPENDS",
      ageRange: null,
      notes: null,
      source: null,
      rationale: `No PayerEMRule matched "${payerName}" (age=${patientAge ?? "?"}, practice=${practiceId ?? "global"}). Defaulting to 99221-99223 family and flagging for human review.`,
    };
  }

  // ─── PayerEMRule CRUD (admin) ─────────────────────────────────────
  //
  // Thin wrappers so the controller doesn't reach into Prisma directly.
  // No role-based authorization yet — currently any authenticated user
  // can edit rules. Tighten when the project introduces an admin role.

  async listPayerRules(params: {
    practiceId?: number | null;
    includeGlobal?: boolean;
  }) {
    const where: { practiceId?: number | null; OR?: unknown[] } = {};
    if (params.practiceId != null) {
      // When a practiceId is supplied, return that practice's rules
      // by default. `includeGlobal=true` also surfaces the
      // practiceId=null catch-alls so an admin can review the full
      // resolution surface in one list.
      if (params.includeGlobal) {
        where.OR = [{ practiceId: params.practiceId }, { practiceId: null }];
      } else {
        where.practiceId = params.practiceId;
      }
    } else {
      // Caller asked for global rules only.
      where.practiceId = null;
    }
    return this.prisma.payerEMRule.findMany({
      where,
      orderBy: [{ category: "asc" }, { payerName: "asc" }, { ageMin: "asc" }],
      include: {
        practice: { select: { id: true, name: true } },
      },
    });
  }

  async getPayerRule(id: number) {
    return this.prisma.payerEMRule.findUnique({
      where: { id },
      include: { practice: { select: { id: true, name: true } } },
    });
  }

  async createPayerRule(data: {
    payerName: string;
    payerPattern?: string | null;
    category: "ALWAYS_INITIAL_HOSPITAL" | "ALWAYS_CONSULT" | "DEPENDS_HUMAN_REVIEW";
    ageMin?: number | null;
    ageMax?: number | null;
    practiceId?: number | null;
    notes?: string | null;
    source?: string | null;
  }) {
    return this.prisma.payerEMRule.create({
      data: {
        payerName: data.payerName.trim(),
        payerPattern: data.payerPattern ?? null,
        category: data.category,
        ageMin: data.ageMin ?? null,
        ageMax: data.ageMax ?? null,
        practiceId: data.practiceId ?? null,
        notes: data.notes ?? null,
        source: data.source ?? null,
      },
    });
  }

  async updatePayerRule(
    id: number,
    data: Partial<{
      payerName: string;
      payerPattern: string | null;
      category: "ALWAYS_INITIAL_HOSPITAL" | "ALWAYS_CONSULT" | "DEPENDS_HUMAN_REVIEW";
      ageMin: number | null;
      ageMax: number | null;
      practiceId: number | null;
      notes: string | null;
      source: string | null;
    }>,
  ) {
    return this.prisma.payerEMRule.update({
      where: { id },
      data: {
        ...(data.payerName !== undefined && {
          payerName: data.payerName.trim(),
        }),
        ...(data.payerPattern !== undefined && {
          payerPattern: data.payerPattern,
        }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.ageMin !== undefined && { ageMin: data.ageMin }),
        ...(data.ageMax !== undefined && { ageMax: data.ageMax }),
        ...(data.practiceId !== undefined && { practiceId: data.practiceId }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.source !== undefined && { source: data.source }),
      },
    });
  }

  async deletePayerRule(id: number) {
    return this.prisma.payerEMRule.delete({ where: { id } });
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
