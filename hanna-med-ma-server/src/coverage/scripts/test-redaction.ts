/**
 * Smoke-test the redaction rules against a realistic Baptist note
 * header. Prints the tokenized output + the tokens map so we can
 * verify by eye that every PHI value was caught.
 */
import { RedactionService } from "../../redaction/redaction.service";

const sample = `PATIENT NAME: Bayona, Arturo Nicolas  DOB: 11/14/1949
FIN: 946100841  CMRN: 21286646
Date of Admission: 03/23/2026
SM_South Miami Hospital
6200 SW 73rd Street
South Miami, FL, 33143-4679
(786)662-8174
MRN: ABC12345
Chart ID: DUMMY-2267-MOCK
Account #: 88-445521
Patient ID: SM-00042
Pt Dr Paul Hanna reviewed.
SSN: 123-45-6789
Email: test@example.com

Vitals: HR 88, BP 115/63, SpO2 95%, WT 86.4 kg
Glucose 162 mg/dL on 04/14/26.`;

const svc = new RedactionService();
const { redacted, tokens } = svc.redact(sample);

console.log("\n=== Tokenized ===\n");
console.log(redacted);

console.log("\n=== Token map ===\n");
for (const [k, v] of Object.entries(tokens)) {
  console.log(`  ${k} → ${v}`);
}

// Round-trip check: rehydrate must reproduce the original.
const rehydrated = svc.rehydrate(redacted, tokens);
console.log("\n=== Round-trip identical? ===");
console.log(rehydrated === sample ? "YES" : "NO");
if (rehydrated !== sample) {
  console.log("\nDiff (first 500 chars):");
  for (let i = 0; i < Math.min(sample.length, rehydrated.length); i++) {
    if (sample[i] !== rehydrated[i]) {
      console.log(
        `  mismatch at ${i}: expected '${sample.slice(i, i + 30)}' got '${rehydrated.slice(i, i + 30)}'`,
      );
      break;
    }
  }
}
