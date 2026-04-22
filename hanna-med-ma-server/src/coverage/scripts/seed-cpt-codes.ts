/**
 * Deduplicates CPTs across the MPFS and LCD-article sources into a
 * single catalog table (cpt_codes) so the embedder has exactly one
 * row per code to embed.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/seed-cpt-codes.ts
 *
 * Source priority for the description of each CPT:
 *   1. fee_schedule_items.description       (CMS official, terse)
 *   2. lcd_article_cpts.description         (richer, Article prose)
 * Both sources are kept: the MPFS description populates `description`
 * and the longer Article blurb (when present) populates `longDescription`.
 */

import { Client } from "pg";

async function main() {
  const databaseUrl = process.env.SERVER_DATABASE_URL;
  if (!databaseUrl) throw new Error("SERVER_DATABASE_URL not set");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Fresh rebuild — cheaper and simpler than reconciling deltas.
    await client.query(`TRUNCATE "cpt_codes" RESTART IDENTITY CASCADE`);

    // One pass against each source, Postgres does the dedup.
    // fee_schedule_items has one "canonical" description per CPT (the
    // no-modifier row wins).  lcd_article_cpts uses the longest text
    // across its rows so we capture the richer Article description.
    const inserted = await client.query(`
			WITH mpfs AS (
			  SELECT DISTINCT ON (cpt) cpt, description, "statusCode"
			  FROM fee_schedule_items
			  WHERE description IS NOT NULL
			  ORDER BY cpt, (CASE WHEN modifier = '' THEN 0 ELSE 1 END), id
			), arts AS (
			  SELECT cpt,
			         (array_agg(description ORDER BY length(description) DESC NULLS LAST))[1] AS long_desc
			  FROM lcd_article_cpts
			  WHERE description IS NOT NULL AND length(description) > 0
			  GROUP BY cpt
			), unioned AS (
			  SELECT COALESCE(mpfs.cpt, arts.cpt) AS cpt,
			         COALESCE(mpfs.description, arts.long_desc, '(no description)') AS description,
			         arts.long_desc AS long_description,
			         mpfs."statusCode" AS status_code
			  FROM mpfs
			  FULL OUTER JOIN arts ON arts.cpt = mpfs.cpt
			)
			INSERT INTO "cpt_codes"
			  ("code","description","longDescription","statusCode","createdAt","updatedAt")
			SELECT cpt, description, long_description, status_code, NOW(), NOW()
			FROM unioned
			WHERE cpt IS NOT NULL
			ON CONFLICT ("code") DO NOTHING
			RETURNING id
		`);

    console.log(`cpt_codes: ${inserted.rowCount} rows seeded.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
