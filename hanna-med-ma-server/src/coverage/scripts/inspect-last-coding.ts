/**
 * Read-only dump of the most recent EncounterCoding row — used to
 * audit what the agent actually did in the last run. Prints the
 * reasoning timeline + the final proposal so we can grade it.
 *
 *   npx ts-node -r dotenv/config -T src/coverage/scripts/inspect-last-coding.ts
 */
import { PrismaClient } from "@prisma/client";

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
  const prisma = new PrismaClient();
  const row = await prisma.encounterCoding.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      encounterId: true,
      status: true,
      primaryCpt: true,
      auditRiskScore: true,
      riskBand: true,
      runDurationMs: true,
      toolCallCount: true,
      errorMessage: true,
      reasoningLog: true,
      proposal: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });

  if (!row) {
    console.log("No coding rows in DB.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\n=== Coding #${row.id} · encounter ${row.encounterId} ===`);
  console.log(
    `status=${row.status}  primary=${row.primaryCpt}  risk=${row.auditRiskScore} (${row.riskBand})`,
  );
  console.log(`duration=${row.runDurationMs}ms  tools=${row.toolCallCount}`);
  console.log(
    `started=${row.startedAt?.toISOString()}  completed=${row.completedAt?.toISOString()}`,
  );
  if (row.errorMessage) console.log(`ERROR: ${row.errorMessage}`);

  const events = (row.reasoningLog as unknown as ReasoningEvent[]) ?? [];
  console.log(`\n=== Reasoning timeline — ${events.length} events ===`);
  for (const e of events) {
    const t = `[${(e.ts / 1000).toFixed(1)}s]`;
    if (e.type === "think") {
      console.log(
        `${t} THINK: ${e.text.replace(/\s+/g, " ").slice(0, 400)}${e.text.length > 400 ? "…" : ""}`,
      );
    } else if (e.type === "tool_call") {
      console.log(`${t} →  ${e.tool}(${JSON.stringify(e.args).slice(0, 200)})`);
    } else {
      console.log(`${t} ←  ${e.tool}: ${e.summary}`);
    }
  }

  console.log(`\n=== Final proposal ===`);
  console.log(JSON.stringify(row.proposal, null, 2).slice(0, 5000));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
