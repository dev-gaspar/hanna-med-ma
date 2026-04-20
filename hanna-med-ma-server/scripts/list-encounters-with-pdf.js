/* eslint-disable */
/**
 * One-off diagnostic: list encounters that have providerNote (PDF) captured.
 * Run from the server directory:
 *   node scripts/list-encounters-with-pdf.js
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
	const encounters = await prisma.encounter.findMany({
		where: { providerNote: { not: null } },
		include: {
			patient: {
				select: {
					id: true,
					name: true,
					emrSystem: true,
					facility: true,
				},
			},
			doctor: { select: { id: true, name: true } },
		},
		orderBy: { dateOfService: "desc" },
		take: 50,
	});

	console.log("");
	console.log(`Encounters with providerNote: ${encounters.length}`);
	console.log("─".repeat(140));

	if (encounters.length === 0) {
		console.log("  (none)");
	} else {
		for (const e of encounters) {
			const dos = e.dateOfService.toISOString().slice(0, 10);
			const facility = e.patient.facility ? ` · ${e.patient.facility}` : "";
			const faceSheet = e.faceSheet ? "yes" : "no";
			console.log(
				[
					`enc#${e.id}`.padEnd(9),
					`patient#${e.patient.id}`.padEnd(13),
					e.patient.name.padEnd(28),
					(e.patient.emrSystem + facility).padEnd(30),
					e.type.padEnd(9),
					dos,
					`note=${e.noteStatus}`.padEnd(22),
					`attempts=${e.noteAttempts}`.padEnd(13),
					`faceSheet=${faceSheet}`,
				].join("  "),
			);
		}
	}

	console.log("");

	const allEncounters = await prisma.encounter.count();
	const withSigned = await prisma.encounter.count({
		where: { noteStatus: "FOUND_SIGNED" },
	});
	const withUnsigned = await prisma.encounter.count({
		where: { noteStatus: "FOUND_UNSIGNED" },
	});
	const notFound = await prisma.encounter.count({
		where: { noteStatus: "NOT_FOUND" },
	});
	const pending = await prisma.encounter.count({
		where: { noteStatus: "PENDING" },
	});
	const searching = await prisma.encounter.count({
		where: { noteStatus: "SEARCHING" },
	});

	console.log("Note-status breakdown (all encounters):");
	console.log(`  total          : ${allEncounters}`);
	console.log(`  FOUND_SIGNED   : ${withSigned}`);
	console.log(`  FOUND_UNSIGNED : ${withUnsigned}`);
	console.log(`  NOT_FOUND      : ${notFound}`);
	console.log(`  PENDING        : ${pending}`);
	console.log(`  SEARCHING      : ${searching}`);
	console.log("");

	await prisma.$disconnect();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
