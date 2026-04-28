# CMS Authoritative Documents — Ingest Guide

This folder is where you drop the PDFs before running the `load-*.ts`
scripts. The PDFs are **not** committed to git (`data/` is in .gitignore
if not, we should add it) — they're large, and CMS publishes fresh
revisions that should be re-downloaded on each ingest.

## What to download

| # | Document | Why we need it | Where to get it |
|---|---|---|---|
| 1 | **Medicare Claims Processing Manual, Chapter 12** (Physicians / Non-physician Practitioners) | §30.6.10 Consultations — the authoritative source for "no consult codes for Medicare" and the 99221-99223 replacement rule. Plus modifier rules (AI, 25, 57), global periods, teaching physician rules. | https://www.cms.gov/regulations-and-guidance/guidance/manuals/internet-only-manuals-ioms-items/cms018912 → click "Downloads" → `clm104c12.pdf` |
| 2 | **ICD-10-CM Official Guidelines for Coding and Reporting (FY 2026)** | Sequencing rules, "code first" / "use additional code" mandates, combination codes, Section IV (outpatient) / Section II (principal diagnosis inpatient). | https://www.cms.gov/medicare/icd-10/2026-icd-10-cm (look for `fy-2026-icd-10-cm-coding-guidelines.pdf`) OR https://www.cdc.gov/nchs/icd/icd-10-cm |
| 3 | **NCCI Policy Manual, Chapter 1 — General Correct Coding Policies** | The WHY behind the per-pair NCCI edits: when a modifier 59 / X{EPSU} can bypass a bundle, rules on anatomically separate structures, separate incisions, staged procedures. | https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/ncci-policy-manual-medicare-services → current year → `chapter1.pdf` |
| 4 | **NCCI Policy Manual, Chapter 3 — Surgery: Integumentary System** *(optional but high-yield for podiatry/wound care)* | Debridement (11042-11047), I&D, excision codes. Bundling rules specific to dermatologic procedures. | Same page as #3, `chapter3.pdf` |
| 5 | **Global Surgery Booklet (MLN 907166)** | Definitions of 0-, 10-, and 90-day global periods; what's bundled pre-op, intra-op, post-op. | https://www.cms.gov/outreach-and-education/medicare-learning-network-mln/mlnproducts/downloads/GloballSurgery-ICN907166.pdf |
| 6 | **Novitas (JL/JH) LCDs relevant to podiatry / wound care / vascular** | Already wired via `load-mcd.ts` + `chunk-lcd-text.ts`. Not re-ingested here. | https://med.noridianmedicare.com (Part B) / cms.gov/medicare-coverage-database |

## Suggested filenames under `data/cms/`

Keep the filename stable — re-running an ingest overwrites prior rows
for the same `(kind, chapter)` key, so renaming a PDF mid-cycle
causes orphans.

```
data/cms/
  clm104c12.pdf                        # CMS Manual Ch.12
  fy-2026-icd-10-cm-coding-guidelines.pdf
  ncci-policy-manual-ch1.pdf
  ncci-policy-manual-ch3.pdf           # optional
  mln-907166-global-surgery.pdf
```

## Ingest commands

Run these from `hanna-med-ma-server/`. Each script is re-runnable
(wipes prior rows for the same source before inserting), so you can
re-run whenever CMS publishes a new revision.

### 1. CMS Claims Processing Manual Ch.12
```bash
npx ts-node -r dotenv/config src/coverage/scripts/load-cms-manual.ts \
  --file ./data/cms/clm104c12.pdf \
  --chapter 12 \
  --version "Rev. 12345 (2024-09-26)" \
  --source-url "https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/clm104c12.pdf"
```

### 2. ICD-10-CM Official Guidelines (already has its own loader)
```bash
npx ts-node -r dotenv/config src/coverage/scripts/load-coding-guidelines.ts \
  --file ./data/cms/fy-2026-icd-10-cm-coding-guidelines.pdf \
  --year 2026
```

### 3. NCCI Policy Manual Ch.1
```bash
npx ts-node -r dotenv/config src/coverage/scripts/load-ncci-policy.ts \
  --file ./data/cms/ncci-policy-manual-ch1.pdf \
  --chapter 1 \
  --version "2026 edition" \
  --source-url "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/ncci-policy-manual-medicare-services"
```

### 4. (Optional) NCCI Policy Manual Ch.3 — Integumentary
```bash
npx ts-node -r dotenv/config src/coverage/scripts/load-ncci-policy.ts \
  --file ./data/cms/ncci-policy-manual-ch3.pdf \
  --chapter 3 \
  --version "2026 edition"
```

### 5. Global Surgery Booklet
```bash
npx ts-node -r dotenv/config src/coverage/scripts/load-global-surgery.ts \
  --file ./data/cms/mln-907166-global-surgery.pdf \
  --version "ICN 907166 (2024 revision)" \
  --source-url "https://www.cms.gov/outreach-and-education/medicare-learning-network-mln/mlnproducts/downloads/GloballSurgery-ICN907166.pdf"
```

### 6. Embed everything
After all the above have inserted rows (embedding column will be NULL),
run the embedder once to compute vectors across all policy rules and
any other tables that have pending embeddings:

```bash
npx ts-node -r dotenv/config src/coverage/scripts/embed-all.ts --only=policy
```

Or embed every pending row across every corpus (CPT / ICD-10 / LCDs /
guidelines / policy) in one go:

```bash
npx ts-node -r dotenv/config src/coverage/scripts/embed-all.ts
```

## Verify it worked

Quick rowcount from psql:
```sql
SELECT kind, COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
       COUNT(*) AS total
  FROM policy_rules
 GROUP BY kind;
```

Should give you one row per kind you ingested, with `embedded = total`
once the embedder has run.

## Schema + query shape

The agent queries the loaded corpus via `search_policy_rules`
(see `src/ai/agents/coder.agent.ts`). Example internal call:

```ts
coverage.searchPolicyRules(
  "consult codes discontinued 99221 initial hospital care",
  /* k */ 5,
  /* kinds */ ["CMS_CLAIMS_MANUAL"],
);
```

Returns the top chunks, each with its `citation` string — e.g.
"CMS Claims Processing Manual Ch.12 §30.6.10" — which the agent
quotes verbatim in its rationale / lcdCitations.

## Adding a new CMS chapter later

The schema accepts any number of chapters per `kind`, so to add
Ch.13 (Radiology) or Ch.23 (Fee Schedule), just run
`load-cms-manual.ts` with `--chapter 13` (or 23). Nothing else
needs to change — the retrieval method searches across every
chapter of every kind.
