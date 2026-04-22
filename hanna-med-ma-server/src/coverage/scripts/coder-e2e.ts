/**
 * End-to-end test of the coding pipeline against a real SIGNED encounter.
 * Spins up Nest standalone, enqueues an async coding run, then polls
 * until the row reaches a terminal state (DRAFT / FAILED).
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/coder-e2e.ts -- 31
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { CodingService } from "../../coding/coding.service";
import { PrismaService } from "../../core/prisma.service";

type ReasoningEvent =
  | { ts: number; type: "think"; text: string }
  | {
      ts: number;
      type: "tool_call";
      tool: string;
      args: Record<string, unknown>;
    }
  | { ts: number; type: "tool_result"; tool: string; summary: string };

async function main() {
  const encounterId = Number(process.argv[process.argv.length - 1]);
  if (!Number.isFinite(encounterId)) {
    console.error("Usage: coder-e2e.ts <encounterId>");
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "error", "warn"],
  });
  const coding = app.get(CodingService);
  const prisma = app.get(PrismaService);

  console.log(`\n→ Enqueuing AI Coder for encounter ${encounterId}`);
  const t0 = Date.now();
  const { coding: row } = await coding.enqueueGeneration(encounterId);
  console.log(`   row id=${row.id}, status=${row.status}`);

  // Poll every 3s, printing new reasoning events as they arrive.
  let lastSeen = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const current = await prisma.encounterCoding.findUnique({
      where: { id: row.id },
      select: {
        status: true,
        reasoningLog: true,
        errorMessage: true,
        primaryCpt: true,
        auditRiskScore: true,
        riskBand: true,
        runDurationMs: true,
      },
    });
    if (!current) throw new Error("row disappeared");
    const events = (current.reasoningLog as unknown as ReasoningEvent[]) ?? [];
    for (const e of events.slice(lastSeen)) {
      if (e.type === "tool_call") {
        console.log(
          `   [${(e.ts / 1000).toFixed(1)}s] → ${e.tool}(${Object.keys(e.args).join(",")})`,
        );
      } else if (e.type === "tool_result") {
        console.log(
          `   [${(e.ts / 1000).toFixed(1)}s] ← ${e.tool}: ${e.summary}`,
        );
      } else {
        const preview = e.text.replace(/\s+/g, " ").slice(0, 120);
        console.log(
          `   [${(e.ts / 1000).toFixed(1)}s] think: ${preview}${e.text.length > 120 ? "…" : ""}`,
        );
      }
    }
    lastSeen = events.length;

    if (current.status === "DRAFT") {
      const ms = Date.now() - t0;
      console.log(
        `\n=== DRAFT coding #${row.id} (${(ms / 1000).toFixed(1)}s wall, ${current.runDurationMs}ms run) ===`,
      );
      console.log(
        `primary=${current.primaryCpt}, score=${current.auditRiskScore}, band=${current.riskBand}`,
      );
      break;
    }
    if (current.status === "FAILED") {
      console.error(`\n(!) FAILED: ${current.errorMessage}`);
      break;
    }
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
