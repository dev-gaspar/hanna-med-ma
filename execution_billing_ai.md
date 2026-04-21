# Execution log — AI Billing Brain

> Estado real del Phase 1 (AI Coder) en el repo. Fuente: `plan_billing_ai.md`
> es el plan. Este documento es lo que **está hecho** con pointers a código, data
> y siguientes pasos. Actualizar al final de cada sesión.

**Última actualización**: 2026-04-20
**Commits relevantes**: `6d8fa0f` → `7856cd9` (todos locales, sin push a `main`).

---

## 1. Qué se construyó hoy

Fase 1+2 del plan (motor regulatorio + AI Coder) está **funcional end-to-end en local** contra el encounter #31 (Bayona Arturo Nicolas, Baptist, nota firmada 2026-04-13).

### 1.1 Stack regulatorio (los 4 libros + catálogo ICD-10 + guías)

| Fuente | Filas | Tabla | Embeddings | Notas |
|---|---|---|---|---|
| **MPFS 2026** (CMS rvu26a.zip) | 18,833 | `fee_schedule_items` + 1 locality (`FL-04 Miami`) | — | Validado contra cálculo manual: 99214 = $145.50 non-fac |
| **NCCI PTP 2026Q2** | 4,493,738 | `ncci_edits` | — | Practitioner + Hospital |
| **MUE 2026Q2** | 33,223 | `mue_limits` | — | Practitioner + Outpatient + DME |
| **LCDs** (MCD weekly export) | 945 docs, 12,932 contractor links, 82 activas para FCSO 09102 | `lcds` + `lcd_contractors` | — | Filtrable por contractor |
| **LCD Articles** | 2,007 docs, 18,130 CPT crosswalks, 476,182 ICD-10 crosswalks | `lcd_articles` + `lcd_article_cpts` + `lcd_article_icd10s` | — | Contienen los coding guidelines específicos de la LCD |
| **ICD-10-CM 2026** (CMS order file) | 98,186 | `icd10_codes` | ✓ 768d | Incluye parents no-billable |
| **CPT catalog dedup** | 17,301 | `cpt_codes` | ✓ 768d | Union de MPFS + article cross-walks |
| **LCD text chunks** | 23,537 | `lcd_text_chunks` | ✓ 768d | ~500 tokens/chunk, sentence-aware greedy pack |
| **ICD-10-CM Official Guidelines FY2026** | 181 chunks | `coding_guidelines` | ✓ 768d | 37 secciones detectadas, cita-able por ID |

**Total**: 5.2M filas · 139k vectores embebidos con Gemini `gemini-embedding-001` @ 768 dim · HNSW + cosine ops.

### 1.2 Motor regulatorio — `CoverageService`

Ubicación: `hanna-med-ma-server/src/coverage/coverage.service.ts`. Expone 8 métodos que el CoderAgent usa como tools:

| Método | Qué hace | Tipo |
|---|---|---|
| `findFee(cpt, locality, year, modifier?)` | MPFS lookup con monto localizado | Exact |
| `searchCpt(query, k)` | Vector search sobre cpt_codes | Semántico |
| `searchIcd10(query, k, billableOnly?)` | Vector search sobre icd10_codes | Semántico |
| `searchLcdChunks(query, k, contractorNumber?)` | Vector search sobre lcd_text_chunks | Semántico |
| `searchCodingGuidelines(query, k)` | Vector search sobre coding_guidelines | Semántico |
| `checkNcciPair(cpt1, cpt2)` | Bundle check, devuelve modifier indicator | Exact |
| `getMueLimit(cpt, serviceType)` | Max units/day | Exact |
| `getLcdsForCpt(cpt, contractorNumber?)` | LCDs que gobiernan un CPT | Join |

HTTP endpoint pensado para debugging: `GET /coverage/fee-schedule?cpt=X&locality=04&year=2026`.

### 1.3 AI Coder — `CoderAgent`

Ubicación: `hanna-med-ma-server/src/ai/agents/coder.agent.ts`.

- **Modelo**: `claude-sonnet-4-6` (Anthropic), temperatura 0.2, non-streaming, 8192 max tokens.
- **Router del chat médico** sigue con `gemini-2.5-flash` (latencia importa ahí).
- **8 tools** vía `createReactAgent` (LangGraph):
  1. `search_cpt_codes`
  2. `search_icd10_codes`
  3. `search_lcd_chunks`
  4. `search_coding_guidelines` ← nuevo
  5. `get_fee_schedule`
  6. `check_ncci_bundle`
  7. `check_mue_limit`
  8. `get_lcds_for_cpt`
  9. `finalize_coding` (exit, zod-validado)
- **System prompt** en `hanna-med-ma-server/src/ai/prompts/coder.prompt.ts`:
  - 3 principios generales (combination codes, pair codes, specificity over "unspecified") — **NO hardcoded specialty rules**.
  - Workflow explícito de 9 pasos, refuerza `search_coding_guidelines` para sequencing.
  - Scoring recipe determinista (0–100) con bandas LOW/REVIEW/RISK.
- **Specialty delta** appended desde `specialty_prompt_deltas` (tabla seed con `Podiatry` + `Internal Medicine`). Match case-insensitive contra `Doctor.specialty`.
- **Prompt caching** con `cache_control: { type: "ephemeral" }` en base + delta → cache de 5 min de Anthropic reusa prompt entre runs consecutivos.
- **PHI redaction** (ver §1.5) aplicada antes de mandar la nota a Claude, rehydrada antes de persistir.

**Zod schema de salida** (`finalize_coding`): `primaryCpt`, `cptProposals[]`, `icd10Proposals[]`, `ncciIssues[]`, `mueIssues[]`, `lcdCitations[]`, `documentationGaps[]`, `providerQuestions[]`, `auditRiskNotes[]`, `auditRiskScore`, `riskBand`, `riskBreakdown[5]`, `summary`, `noteText`.

### 1.4 Persistencia — `EncounterCoding`

Ubicación: `hanna-med-ma-server/src/coding/`.

- **Modelo Prisma**: states `DRAFT → UNDER_REVIEW → APPROVED → TRANSFERRED_TO_CARETRACKER | DENIED`, plus `basedOnNoteVersion: DRAFT|SIGNED` per plan §3.7.
- Flattened `primaryCpt`, `auditRiskScore`, `riskBand`, `toolCallCount`, `runDurationMs` para Coder Inbox futuro.
- Proposal JSON completo + `noteText` rehydrated persisted en el campo JSON `proposal`.
- Audit trail `approvedByDoctorId` + `approvedAt`.

### 1.5 Redaction service — HIPAA boundary

Ubicación: `hanna-med-ma-server/src/redaction/`. Portado de `hannamed-scribe` de Adony.

- 9 reglas regex: `SSN`, `PHONE`, `EMAIL`, `MRN`, `DOB`, `DATE`, `ADDRESS`, `ZIP`, `NAME`.
- `redact(text)` → `{ redacted, tokens }`.
- `rehydrate(text, tokens)` y `rehydrateDeep(obj, tokens)` (recursivo en JSON).
- Integrado en `CodingService.generateForEncounter`: la nota pasa por `redact()` **antes** de llegar a Claude; la respuesta pasa por `rehydrateDeep()` antes de persistir.

### 1.6 Frontend — `CodingPanel`

Ubicación: `hanna-med-ma-client/src/pages/doctor/CodingPanel.tsx`.

Layout (basado en el `coder.jsx` del Remix design de referencia):
- **xl ≥1280px**: 3 columnas `1fr | 320px | 280px`
  - Col 1: nota con evidence highlights (`<span>` data-code, scroll-to on selection)
  - Col 2: Suggested bill (CPTs + ICD chips + gaps + provider questions)
  - Col 3: Defense (audit risk meter + breakdown + LCD citations + sign-off)
- **<xl**: stacked vertical, scroll a nivel de sección.
- **Fullscreen**: Button next to Re-run → `fixed inset-0 z-[60]` portalleado a `document.body` (evita ancestor transform issues). Esc exits, body scroll locked.
- **Dark mode**: fixes aplicados en `CodeChip primary` (`dark:text-white`) y highlights ICD (`dark:text-white` — el design system solo swap-ea p-50/100/200, no los text tokens p-700+).
- **Click a CPT/ICD chip** → `selectedCode` state → `useEffect` en `NoteWithHighlights` hace `scrollIntoView({smooth, center})` al `<span data-code="X">` correspondiente.

Componentes nuevos en `hanna-med-ma-client/src/components/ui/`:
- `CodeChip.tsx` — pill CPT/ICD con modifier tail
- `AuditRiskMeter.tsx` — score + band chip + progress bar
- `NoteWithHighlights.tsx` — renderer con `<span>` highlights + PDF whitespace cleanup + scroll

Flag `isNew` en patient lists estáticas (antes solo estaba en chat): `hanna-med-ma-client/src/lib/patientFlags.ts`.

### 1.7 Endpoints HTTP (todos JWT-guarded)

| Método | Ruta | Uso |
|---|---|---|
| POST | `/coding/encounters/:id/generate` | Corre el agente, persiste DRAFT |
| GET | `/coding/encounters/:id` | Último proposal o null |
| GET | `/coding/encounters/:id/history` | Todos los passes |
| PATCH | `/coding/proposals/:id/approve` | Sign-off |
| PATCH | `/coding/proposals/:id/transferred` | Hajira marca transferido a CareTracker |
| POST | `/coding/propose` | Debug only: nota cruda → proposal sin persistir |

---

## 2. Cómo correr todo de cero

Asumiendo DB limpia (Postgres 18 con pgvector — imagen `pgvector/pgvector:pg18-trixie`).

```bash
cd hanna-med-ma-server

# 1. Dependencias
npm install

# 2. Aplicar todas las migraciones
npx prisma migrate deploy

# 3. Regenerar cliente (en Windows, si falla por lock del .dll:
#    mover aside temporalmente)
npx prisma generate

# 4. Descargar fuentes de CMS (ver §3 para tamaños)
#    MPFS, NCCI, MUE, LCD/Articles, ICD-10-CM, Guidelines

# 5. Cargar los 4 libros regulatorios + catálogo ICD-10 + guías
npx ts-node -r dotenv/config -T src/coverage/scripts/load-mpfs.ts \
  --rvu ./data/mpfs/2026/PPRRVU2026_Jan_nonQPP.csv \
  --gpci ./data/mpfs/2026/GPCI2026.csv \
  --year 2026 --state FL --locality 04

npx ts-node -r dotenv/config -T src/coverage/scripts/load-ncci.ts \
  --dir ./data/ncci/2026q2 --quarter 2026Q2

npx ts-node -r dotenv/config -T src/coverage/scripts/load-mue.ts \
  --dir ./data/mue/2026q2 --effective 2026-04-01

npx ts-node -r dotenv/config -T src/coverage/scripts/load-mcd.ts \
  --lcd-dir ./data/mcd/lcd/csv \
  --article-dir ./data/mcd/article/csv

npx ts-node -r dotenv/config -T src/coverage/scripts/load-icd10.ts \
  --file "./data/icd10/april/Code Descriptions/icd10cm_order_2026.txt"

npx ts-node -r dotenv/config -T src/coverage/scripts/load-coding-guidelines.ts \
  --file ./data/icd10/guidelines/fy2026-icd10cm-guidelines.pdf --year 2026

# 6. Dedup de CPT catalog + chunk LCDs
npx ts-node -r dotenv/config -T src/coverage/scripts/seed-cpt-codes.ts
npx ts-node -r dotenv/config -T src/coverage/scripts/chunk-lcd-text.ts

# 7. Embeddings con Gemini (toma ~1h, cost ~$1.65)
npx ts-node -r dotenv/config -T src/coverage/scripts/embed-all.ts --concurrency=2

# 8. Seed specialty prompt deltas
npx ts-node -r dotenv/config -T src/coverage/scripts/seed-specialty-prompts.ts

# 9. Smoke test
npx ts-node -r dotenv/config -T src/coverage/scripts/search-probe.ts \
  --q "diabetic foot ulcer debridement" --k 6

# 10. E2E contra un encounter real con nota firmada
npx ts-node -r dotenv/config -T src/coverage/scripts/coder-e2e.ts -- 31
```

Frontend:
```bash
cd hanna-med-ma-client
npm install
npm run dev   # http://localhost:5173
```

---

## 3. Dependencias nuevas introducidas

### Server (`hanna-med-ma-server`)

| Paquete | Por qué |
|---|---|
| `@langchain/anthropic` | Claude Sonnet 4.6 para el CoderAgent |
| `@google/genai` | Embeddings (Gemini 768d) + cualquier uso futuro del SDK nuevo |
| `pdf-parse` | Extrae texto de PDFs (notas firmadas + ICD-10 Guidelines) |
| `pg` + `pg-copy-streams` | COPY FROM STDIN para el loader de NCCI (5M filas) |

### Fuentes de datos externas (gitignored en `data/`)

| Fuente | URL | Tamaño |
|---|---|---|
| `rvu26a.zip` (MPFS 2026) | `cms.gov/files/zip/rvu26a-updated-12-29-2025.zip` | ~6 MB zip |
| NCCI PTP 2026Q2 × 8 ZIPs | `cms.gov/files/zip/medicare-ncci-2026q2-*-ptp-edits-*.zip` | ~160 MB zipped |
| MUE 2026Q2 × 3 ZIPs | `cms.gov/files/zip/medicare-ncci-2026-q2-*-mue-table.zip` | ~1 MB |
| MCD LCD + Article current | `downloads.cms.gov/medicare-coverage-database/downloads/exports/current_{lcd,article}.zip` | ~90 MB |
| ICD-10-CM 2026 descriptions | `cms.gov/files/zip/april-1-2026-code-descriptions-tabular-order.zip` | ~2 MB |
| ICD-10-CM Official Guidelines FY2026 | `cms.gov/files/document/fy-2026-icd-10-cm-coding-guidelines.pdf` | 838 KB |

### Variables de entorno nuevas (`.env`)

```
SERVER_ANTHROPIC_API_KEY=sk-ant-...   # para el CoderAgent
SERVER_GEMINI_API_KEY=...             # ya existente, ahora también embeddings
```

### Infra

- **Postgres 18** con extensión **pgvector** (imagen `pgvector/pgvector:pg18-trixie` en Dokploy).
- Redis (ya existente).

---

## 4. Métricas actuales (encounter #31 Bayona)

| Métrica | Valor |
|---|---|
| Runtime end-to-end | ~7 min (PDF download + extract + agent + rehydrate + persist) |
| Tool calls | 41 (8 distintas) |
| Coste estimado Claude | ~$0.10 / encounter (pre-cache), ~$0.04 post-cache en runs subsecuentes |
| CPTs propuestos | `99233` |
| ICDs propuestos | `I70.262`, `I70.235`, `L97.519`, `A41.02`, `M86.172`, `N17.9`, `Z79.4` |
| LCD citations | 2 |
| Documentation gaps | 6 |
| Provider questions | 6 |
| Audit risk score | 42 / 100 REVIEW |

El agente consultó `search_coding_guidelines` para decidir ordering entre `E11.621` vs `I70.235` cuando ambos son válidos — por la guideline ICD-10-CM §I.C.9.b.1, la aterosclerosis con ulceración tiene priority sobre la diabetes cuando ambas están documentadas como causa de la úlcera. **Es exactamente la especificidad que queríamos.**

---

## 5. Deuda conocida

1. **PHI redaction no cubre todos los patrones**. La implementación regex de Adony funciona pero puede dejar pasar nombres raros (multi-palabra, acentos), IDs específicos de hospital (Baptist chart IDs distintos al MRN estándar), etc. → considerar un tercero (AWS Comprehend Medical) si la exigencia compliance sube.

2. **ICD-10 sin punto**. Nuestra tabla `icd10_codes` guarda códigos sin punto (`E11621`). El agente emite con punto (`E11.621`). Mayormente funciona por el vector search pero puede fallar en lookups exact. Normalizar en un pre-save hook cuando movamos esto.

3. **`embed-all.ts` usa Gemini**, no Claude. Para un stack 100% Anthropic habría que cambiar a `voyage-3` o similar. No urgente — la calidad de Gemini embeddings es buena para nuestro recall.

4. **Sin auto-trigger**. El CoderAgent se dispara por botón "Run AI Coder" en la UI. Cuando validemos calidad con Hajira, hookearlo al flow RPA (cuando `noteStatus → FOUND_SIGNED`).

5. **Sin Coder Inbox** (pantalla H del Remix design). Ya tenemos los flattened fields (`primaryCpt`, `auditRiskScore`, `riskBand`, `runDurationMs`) listos para filtrar, solo falta la vista.

6. **Fase 1 local only**. Todos los commits en `main` local, **no push a prod todavía**. Es política explícita del Dr. Peter para esta fase (ver memoria `feedback_phase1_local_only.md`).

7. **Prisma client regen en Windows**. Recurrente EPERM lock sobre `query_engine-windows.dll.node` por VSCode TS server. Workaround: `mv node_modules/.prisma/client/query_engine-windows.dll.node{,.OLD}` antes de `npx prisma generate`.

---

## 6. Next steps — en orden de payoff

Referencia: `plan_billing_ai.md` §4.

### 6.1 Inmediato (próxima sesión)

1. **Pedirle al Dr. Peter los 3 entregables de la reunión 2026-04-18** (si aún no los tiene):
   - 50 encounters históricos de Baptist codificados por Hajira (**métrica de éxito Fase 1+2 del plan**).
   - Ejemplos reales de denials (para entrenar el `documentation gap agent`).
   - Walkthrough de CareTracker con David de AM Cornell.
2. **Validar AI Coder contra los 50 históricos**. Target: >80% match en primary CPT vs Hajira. Script de diffing automatizable — persistir cada run en `EncounterCoding` y hacer query.
3. **Agregar más specialty deltas**: Cardiology, Vascular Surgery, Wound Care, Psych, OB/GYN. Cada uno ~2-3 horas de prompt engineering + revisión con el doctor de esa especialidad.

### 6.2 Esta semana

4. **Coder Inbox UI** (pantalla H del Remix design) — cola global para Hajira con filtros por riesgo/hospital/doctor. La BD ya tiene todo flattenado, es solo frontend.
5. **Auto-trigger**: cuando el RPA marca `noteStatus = FOUND_SIGNED`, enqueue un job que corre el CoderAgent. Redis ya está.
6. **Redaction enhancement**: agregar `[PATIENT_ID]` (Baptist chart IDs) a las reglas. Quizá probar AWS Comprehend Medical como fallback para producción.

### 6.3 Fase 3 — Scribe híbrido (según plan)

La UI + arquitectura de `hannamed-scribe` de Adony (Next.js + NestJS + Claude + redaction + prompt caching) es reusable. Decisión pendiente:
- ¿Fusionamos repos en un monorepo unificado? O
- ¿Mantenemos dos codebases con shared libs?

Mi recomendación: monorepo Nx (como Adony montó) con `apps/api`, `apps/client` (el actual), `apps/scribe-web`, `libs/coverage`, `libs/coding`, `libs/redaction`. Refactor importante pero de una sola vez.

### 6.4 Fase 4 — Aurelius EMR (retomada de Adony)

Sin cambios al plan original. Depende de la prioridad post-validación de Fase 1+2.

### 6.5 Fase 5 — Revenue Integrity / Apelaciones

Requiere:
- Los denials reales del Dr. Peter + AM Cornell.
- Tabla `Claim` con estados + métricas.
- `DenialPredictionAgent` que corre antes del submit (tenemos toda la base: NCCI, MUE, LCDs + audit risk score).

---

## 7. Puntos abiertos para el Dr. Peter

1. Los 50 encounters históricos de Baptist (bloqueante Fase 1+2 validación).
2. Denials reales (bloqueante Fase 5).
3. Walkthrough CareTracker con David AM Cornell (depende de David).
4. ¿Probamos el AI Coder en vivo con Hajira esta semana o esperamos a validar los 50 primero?
5. ¿Lista de especialidades prioritarias para seed-specialty-prompts.ts? Hoy tenemos Podiatry + Internal Medicine.

---

*Fin del documento. Actualizar al final de cada sesión de trabajo.*
