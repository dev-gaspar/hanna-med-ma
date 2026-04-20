import { Client } from "pg";

async function main() {
	const c = new Client({ connectionString: process.env.SERVER_DATABASE_URL });
	await c.connect();

	console.log("=== MUE (Practitioner, 2026-04-01) for 99214, 11721, 11055 ===");
	const mue = await c.query(
		`SELECT cpt, "mueValue", mai, "adjudicationIndicator", rationale
		 FROM mue_limits
		 WHERE cpt = ANY($1) AND "serviceType" = 'PRACTITIONER'
		 ORDER BY cpt`,
		[["99214", "11721", "11055", "29877"]],
	);
	console.table(mue.rows);

	console.log("\n=== NCCI: what bundles with 99214 (col1=99214), active ===");
	const ncci = await c.query(
		`SELECT "column1Cpt", "column2Cpt", "modifierIndicator", rationale, "editType"
		 FROM ncci_edits
		 WHERE "column1Cpt" = '99214' AND "deletionDate" IS NULL
		 ORDER BY "column2Cpt" LIMIT 8`,
	);
	console.table(ncci.rows);

	console.log("\n=== NCCI: total currently active (practitioner only) ===");
	const ncciActive = await c.query(
		`SELECT COUNT(*)::int AS n FROM ncci_edits
		 WHERE "editType" = 'PRACTITIONER' AND "deletionDate" IS NULL`,
	);
	console.log(`  ${ncciActive.rows[0].n.toLocaleString()} active edits`);

	console.log("\n=== LCDs for First Coast Part B Florida (09102) ===");
	const fcso = await c.query(
		`SELECT l.id, l."lcdId", l.title, l.status
		 FROM lcds l
		 JOIN lcd_contractors lc ON lc."lcdId" = l.id
		 WHERE lc."contractorNumber" = '09102'
		 ORDER BY l."lcdId"
		 LIMIT 10`,
	);
	console.table(fcso.rows);

	const fcsoCount = await c.query(
		`SELECT COUNT(DISTINCT l.id)::int AS n
		 FROM lcds l JOIN lcd_contractors lc ON lc."lcdId" = l.id
		 WHERE lc."contractorNumber" = '09102'`,
	);
	console.log(
		`  Total FCSO LCDs: ${fcsoCount.rows[0].n.toLocaleString()}`,
	);

	console.log("\n=== Article CPT codes linked to an FCSO LCD (sample) ===");
	const link = await c.query(
		`SELECT DISTINCT l."lcdId" AS lcd, l.title AS lcd_title, a."articleId" AS article,
		        ac.cpt, ac.description
		 FROM lcds l
		 JOIN lcd_contractors lc ON lc."lcdId" = l.id AND lc."contractorNumber" = '09102'
		 JOIN lcd_article_links lal ON lal."lcdId" = l.id
		 JOIN lcd_articles a ON a.id = lal."articleId"
		 JOIN lcd_article_cpts ac ON ac."articleId" = a.id
		 WHERE ac.cpt IN ('11721','11055','29877','99214')
		 LIMIT 10`,
	);
	console.table(link.rows);

	console.log("\n=== MPFS (already loaded) sample ===");
	const mpfs = await c.query(
		`SELECT cpt, "amountUsd", "amountFacilityUsd" FROM fee_schedule_items
		 WHERE cpt IN ('99214','11721','29877') AND year = 2026 ORDER BY cpt`,
	);
	console.table(mpfs.rows);

	await c.end();
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
