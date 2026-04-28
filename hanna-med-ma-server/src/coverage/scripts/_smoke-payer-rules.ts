/**
 * Smoke test: verify the resolver + admin list service work after the
 * seed bug fix and the catch-all addition. Not part of the regular
 * batch; one-shot CLI.
 *
 *   npx ts-node -r dotenv/config src/coverage/scripts/_smoke-payer-rules.ts
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { CoverageService } from "../coverage.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"],
  });
  const cov = app.get(CoverageService);

  // Test 1: Self-Pay 38yo should hit ALWAYS_CONSULT (the row that
  // was previously colliding with the catch-all in the seed).
  const r38 = await cov.lookupPayerRule({
    payerName: "Self Pay",
    patientAge: 38,
    practiceId: 1,
  });
  console.log("Self Pay age 38 →", {
    matchType: r38.matchType,
    ruleId: r38.ruleId,
    category: r38.category,
    family: r38.eligibleFamily,
  });

  // Test 2: Self-Pay 70yo should hit ALWAYS_INITIAL_HOSPITAL.
  const r70 = await cov.lookupPayerRule({
    payerName: "Self Pay",
    patientAge: 70,
    practiceId: 1,
  });
  console.log("Self Pay age 70 →", {
    matchType: r70.matchType,
    ruleId: r70.ruleId,
    category: r70.category,
    family: r70.eligibleFamily,
  });

  // Test 3: Unknown payer should hit GLOBAL_PATTERN (catch-all) now
  // that the global wildcard row exists.
  const ru = await cov.lookupPayerRule({
    payerName: "Some Random Unknown Plan XYZ",
    patientAge: 55,
    practiceId: 1,
  });
  console.log("Unknown →", {
    matchType: ru.matchType,
    ruleId: ru.ruleId,
    category: ru.category,
  });

  // Test 4: Admin list service returns practice + global rows.
  const rules = await cov.listPayerRules({
    practiceId: 1,
    includeGlobal: true,
  });
  const globals = rules.filter((r) => r.practiceId === null);
  const practice = rules.filter((r) => r.practiceId === 1);
  console.log("listPayerRules(practice=1, includeGlobal=true):");
  console.log("  total:", rules.length);
  console.log("  practice rows:", practice.length);
  console.log("  global rows:", globals.length);

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
