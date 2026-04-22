import { Client } from "pg";
async function main() {
  const c = new Client({ connectionString: process.env.SERVER_DATABASE_URL });
  await c.connect();
  for (const t of [
    "ncci_edits",
    "mue_limits",
    "lcds",
    "lcd_articles",
    "lcd_contractors",
    "lcd_article_cpts",
    "lcd_article_icd10s",
  ]) {
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    console.log(`${t}: ${r.rows[0].n.toLocaleString()}`);
  }
  await c.end();
}
main();
