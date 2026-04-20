/**
 * End-to-end test of the coding pipeline against a real SIGNED encounter.
 * Spins up Nest standalone, calls CodingService.generateForEncounter,
 * and dumps the persisted proposal.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/coder-e2e.ts -- 31
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { CodingService } from "../../coding/coding.service";

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

	console.log(`\n→ Running AI Coder for encounter ${encounterId}`);
	const t0 = Date.now();
	const { coding: row, proposal } = await coding.generateForEncounter(
		encounterId,
	);
	const ms = Date.now() - t0;

	console.log(`\n=== Persisted coding #${row.id}  (${(ms / 1000).toFixed(1)}s) ===`);
	if (!proposal) {
		console.log("(!) No proposal returned — agent didn't finalize.");
	} else {
		console.log(
			`primary=${proposal.primaryCpt}, score=${proposal.auditRiskScore}, band=${proposal.riskBand}`,
		);
		console.log(
			`cpts: ${proposal.cptProposals.map((c) => `${c.code}${c.modifiers.length ? "-" + c.modifiers.join(",") : ""}`).join(", ")}`,
		);
		console.log(`icd10: ${proposal.icd10Proposals.map((i) => i.code).join(", ")}`);
		console.log(`lcd citations: ${proposal.lcdCitations.length}`);
		console.log(`doc gaps: ${proposal.documentationGaps.length}`);
		console.log(`provider questions: ${proposal.providerQuestions.length}`);
	}

	await app.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
