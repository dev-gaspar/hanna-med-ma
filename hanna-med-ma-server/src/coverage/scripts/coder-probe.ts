/**
 * End-to-end probe of the AI Coder against a realistic clinical note.
 * Spins up a Nest standalone context, invokes CoderAgent.run(),
 * and pretty-prints the structured proposal.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/coder-probe.ts
 */

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { CoderAgent } from "../../ai/agents/coder.agent";

const NOTE = `PODIATRY PROGRESS NOTE — 2026-04-20

Subjective: 80yo M with h/o Type 2 diabetes mellitus c/b peripheral
neuropathy and PVD. Presents with chronic mycotic toenails, several
with subungual debris. He reports intermittent pain walking, ambulates
with cane. No fever, no new ulceration today.

Objective:
- Vitals stable, afebrile
- Right and left feet: dystrophic, thickened, discolored toenails
  on all 10 digits, crumbling subungual debris, Class B findings
  (absent posterior tibial + dorsalis pedis pulses bilaterally),
  diminished vibratory sensation consistent with neuropathy
- No active ulceration, no cellulitis, no drainage
- Small neuropathic callus right 1st MTP, no breakdown

Assessment:
1. Onychomycosis, bilateral (all 10 toenails), with secondary
   pain and difficulty ambulating
2. Diabetic peripheral neuropathy, long-standing
3. Peripheral vascular disease with Class B findings

Plan:
- Mycotic nail debridement, all 10 nails, performed today in office
  using nail nippers and rotary burr; maximal nail plate removed
  consistent with LCD requirements
- Patient tolerated procedure well
- Routine foot exam: diabetic foot education reinforced
- Return in 9 weeks for repeat nail debridement

Signed: Dr. Peter Hanna, DPM
Place of Service: 11 (Office)
`;

async function main() {
	const app = await NestFactory.createApplicationContext(AppModule, {
		logger: ["log", "error", "warn"],
	});
	const coder = app.get(CoderAgent);

	console.log("\n=== Note ===");
	console.log(NOTE.slice(0, 300), "…\n");

	const t0 = Date.now();
	const result = await coder.run({
		noteText: NOTE,
		locality: "04",
		contractorNumber: "09102",
		year: 2026,
		specialty: "Podiatry",
		pos: "11",
	});
	const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

	console.log(`=== Tool calls (${elapsed}s) ===`);
	console.log(result.toolCalls.join(" → "));

	if (result.proposal) {
		console.log("\n=== Proposal ===");
		console.log(JSON.stringify(result.proposal, null, 2));
	} else {
		console.log(
			"\n⚠ No structured proposal captured. Raw agent text:\n",
			result.rawText.slice(0, 2000),
		);
	}

	await app.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
