import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CoverageService } from "./coverage.service";
import {
  CreatePayerEMRuleDto,
  UpdatePayerEMRuleDto,
} from "./dto/payer-em-rule.dto";

// Friendly jurisdiction aliases → MAC contractor numbers (Part B).
// "FL" maps to First Coast Service Options Part B for Florida — the
// only jurisdiction the practice currently bills against. Adding new
// states later is a one-line addition; we deliberately do NOT expand
// to every MAC up front because the rest of the regulatory engine
// (LCDs, MPFS) is also Florida-tuned.
const JURISDICTION_TO_CONTRACTORS: Record<string, string[]> = {
  FL: ["09102"], // First Coast Part B Florida
};

@ApiTags("Coverage")
@Controller("coverage")
export class CoverageController {
  constructor(private readonly coverage: CoverageService) {}

  @Get("fee-schedule")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "Localized Medicare Physician Fee Schedule lookup (CPT + locality + year)",
  })
  @ApiQuery({ name: "cpt", required: true, example: "99214" })
  @ApiQuery({ name: "locality", required: true, example: "04" })
  @ApiQuery({ name: "state", required: false, example: "FL" })
  @ApiQuery({ name: "year", required: false, example: 2026 })
  @ApiQuery({ name: "modifier", required: false, example: "26" })
  async feeSchedule(
    @Query("cpt") cpt: string,
    @Query("locality") locality: string,
    @Query("state") state?: string,
    @Query("year") year?: string,
    @Query("modifier") modifier?: string,
  ) {
    return this.coverage.findFee({
      cpt,
      locality,
      state,
      year: year ? Number(year) : new Date().getFullYear(),
      modifier,
    });
  }

  @Get("lcds")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "List LCDs + Articles that govern a specific CPT in a given MAC jurisdiction",
    description:
      "Wraps CoverageService.getLcdsForCpt(). Use either `jurisdiction` " +
      "(friendly alias, e.g. 'FL' → First Coast Part B 09102) or " +
      "`contractor` (raw MAC contractor number) to filter — `contractor` " +
      "wins when both are provided. `payer` is accepted for forward " +
      "compatibility (payer-specific LCD overrides are not yet loaded) " +
      "and echoed back in `meta.payerFilterApplied=false` so callers " +
      "know it had no effect.",
  })
  @ApiQuery({ name: "cpt", required: true, example: "99214" })
  @ApiQuery({
    name: "jurisdiction",
    required: false,
    example: "FL",
    description: "Friendly alias. Currently supported: FL.",
  })
  @ApiQuery({
    name: "contractor",
    required: false,
    example: "09102",
    description: "Raw MAC contractor number; overrides jurisdiction.",
  })
  @ApiQuery({
    name: "payer",
    required: false,
    example: "Humana",
    description: "Reserved — payer-specific filtering not yet implemented.",
  })
  async lcdsForCpt(
    @Query("cpt") cpt: string,
    @Query("jurisdiction") jurisdiction?: string,
    @Query("contractor") contractor?: string,
    @Query("payer") payer?: string,
  ) {
    if (!cpt || !cpt.trim()) {
      throw new BadRequestException("`cpt` query parameter is required");
    }
    const cleanCpt = cpt.trim();

    // Resolve which contractor numbers to filter by. `contractor` wins
    // when given (lets external callers point at any MAC); otherwise
    // we map the friendly jurisdiction alias.
    let contractorNumbers: string[] | undefined;
    let jurisdictionResolved: string | null = null;
    if (contractor && contractor.trim()) {
      contractorNumbers = [contractor.trim()];
    } else if (jurisdiction && jurisdiction.trim()) {
      const key = jurisdiction.trim().toUpperCase();
      const mapped = JURISDICTION_TO_CONTRACTORS[key];
      if (!mapped) {
        throw new BadRequestException(
          `Unknown jurisdiction '${jurisdiction}'. Supported: ${Object.keys(
            JURISDICTION_TO_CONTRACTORS,
          ).join(", ")}. Pass \`contractor\` directly for unmapped MACs.`,
        );
      }
      contractorNumbers = mapped;
      jurisdictionResolved = key;
    }

    // The service signature accepts a single contractor; iterate when
    // a jurisdiction maps to multiple (today only FL→09102, but the
    // shape is ready for FL→[09101,09102] etc.). De-dup on
    // (lcdId, articleId) since the same article can appear under
    // different contractors within one jurisdiction.
    let rows: Awaited<ReturnType<CoverageService["getLcdsForCpt"]>>;
    if (!contractorNumbers || contractorNumbers.length === 0) {
      rows = await this.coverage.getLcdsForCpt(cleanCpt);
    } else if (contractorNumbers.length === 1) {
      rows = await this.coverage.getLcdsForCpt(
        cleanCpt,
        contractorNumbers[0],
      );
    } else {
      const all = await Promise.all(
        contractorNumbers.map((c) =>
          this.coverage.getLcdsForCpt(cleanCpt, c),
        ),
      );
      const seen = new Set<string>();
      rows = [];
      for (const r of all.flat()) {
        const key = `${r.lcdId}|${r.articleId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(r);
      }
    }

    return {
      meta: {
        cpt: cleanCpt,
        jurisdiction: jurisdictionResolved,
        contractorsApplied: contractorNumbers ?? null,
        payer: payer ?? null,
        payerFilterApplied: false,
        count: rows.length,
      },
      results: rows,
    };
  }

  // ─── PayerEMRule CRUD (admin) ─────────────────────────────────────
  //
  // Lets the admin (or Hajira) edit the practice's payer matrix
  // without re-running seed scripts. All endpoints sit behind
  // JwtAuthGuard — no role-based restriction yet because the project
  // doesn't have a role model. Tighten when one is introduced.

  @Get("payer-rules")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "List PayerEMRule rows (scope by practice or global only)",
    description:
      "Pass `practiceId` to scope to a practice's matrix. Pass " +
      "`includeGlobal=true` alongside `practiceId` to also surface " +
      "the global catch-all rows (`practiceId=null`). Omit `practiceId` " +
      "entirely to list only the global rows.",
  })
  @ApiQuery({ name: "practiceId", required: false, example: 1 })
  @ApiQuery({ name: "includeGlobal", required: false, example: false })
  async listPayerRules(
    @Query("practiceId") practiceId?: string,
    @Query("includeGlobal") includeGlobal?: string,
  ) {
    const pid =
      practiceId != null && practiceId !== "" ? Number(practiceId) : null;
    if (practiceId != null && practiceId !== "" && Number.isNaN(pid)) {
      throw new BadRequestException(
        `practiceId must be a number, got "${practiceId}"`,
      );
    }
    return this.coverage.listPayerRules({
      practiceId: pid,
      includeGlobal: includeGlobal === "true",
    });
  }

  @Get("payer-rules/:id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Fetch one PayerEMRule by id" })
  @ApiParam({ name: "id", example: 1 })
  async getPayerRule(@Param("id", ParseIntPipe) id: number) {
    const rule = await this.coverage.getPayerRule(id);
    if (!rule) throw new NotFoundException(`PayerEMRule #${id} not found`);
    return rule;
  }

  @Post("payer-rules")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Create a new PayerEMRule" })
  @ApiBody({ type: CreatePayerEMRuleDto })
  async createPayerRule(@Body() body: CreatePayerEMRuleDto) {
    return this.coverage.createPayerRule(body);
  }

  @Patch("payer-rules/:id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Update an existing PayerEMRule (any subset of fields)",
  })
  @ApiParam({ name: "id", example: 1 })
  @ApiBody({ type: UpdatePayerEMRuleDto })
  async updatePayerRule(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdatePayerEMRuleDto,
  ) {
    const existing = await this.coverage.getPayerRule(id);
    if (!existing) throw new NotFoundException(`PayerEMRule #${id} not found`);
    return this.coverage.updatePayerRule(id, body);
  }

  @Delete("payer-rules/:id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a PayerEMRule" })
  @ApiParam({ name: "id", example: 1 })
  async deletePayerRule(@Param("id", ParseIntPipe) id: number) {
    const existing = await this.coverage.getPayerRule(id);
    if (!existing) throw new NotFoundException(`PayerEMRule #${id} not found`);
    await this.coverage.deletePayerRule(id);
  }
}
