-- Per-specialty system-prompt deltas so the AI Coder can adjust
-- its exam template + code preferences without touching the base
-- prompt (specialty-scalable, replaces the earlier hardcoded rules).

CREATE TABLE "specialty_prompt_deltas" (
    "id"           SERIAL PRIMARY KEY,
    "specialty"    TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "specialty_prompt_deltas_specialty_key"
  ON "specialty_prompt_deltas" ("specialty");
