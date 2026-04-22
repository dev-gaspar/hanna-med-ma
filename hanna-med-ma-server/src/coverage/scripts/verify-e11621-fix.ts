/**
 * Verify the HNSW ef_search fix through the actual CoverageService
 * path — not a side-channel SQL. This is the call shape the agent
 * uses, so if E11.621 surfaces here, the agent will see it too.
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { CoverageService } from "../coverage.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"],
  });
  const coverage = app.get(CoverageService);

  const queries = [
    "type 2 diabetes with foot ulcer",
    "type 2 diabetes mellitus with diabetic foot ulcer",
    "diabetes mellitus with foot ulcer",
    "diabetes mellitus type 2 with diabetic chronic ulcer foot",
  ];

  for (const q of queries) {
    console.log(`\n=== "${q}" ===`);
    const hits = await coverage.searchIcd10(q, 6, true);
    for (const h of hits) {
      const mark = h.code === "E11.621" ? " ← E11.621" : "";
      console.log(
        `  ${h.similarity.toFixed(3)}  ${h.code.padEnd(10)} ${h.longDescription.slice(0, 70)}${mark}`,
      );
    }
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
