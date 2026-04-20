-- Vector / semantic-search layer for the regulatory engine.
-- Requires the Postgres image to include the pgvector extension
-- (we use pgvector/pgvector:pg18-trixie on Dokploy).

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── ICD-10-CM catalog ──────────────────────────────────────

CREATE TABLE "icd10_codes" (
    "id"               SERIAL PRIMARY KEY,
    "code"             TEXT NOT NULL,
    "orderNumber"      INTEGER NOT NULL,
    "isBillable"       BOOLEAN NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "longDescription"  TEXT NOT NULL,
    "embedding"        vector(768),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "icd10_codes_code_key" ON "icd10_codes" ("code");

-- HNSW on the embedding column for fast cosine search.
-- pgvector ignores NULL embeddings, so this is safe to create
-- before any embeddings have been written.
CREATE INDEX "icd10_codes_embedding_idx"
  ON "icd10_codes" USING hnsw ("embedding" vector_cosine_ops);

-- ─── CPT/HCPCS catalog ──────────────────────────────────────

CREATE TABLE "cpt_codes" (
    "id"              SERIAL PRIMARY KEY,
    "code"            TEXT NOT NULL,
    "description"     TEXT NOT NULL,
    "longDescription" TEXT,
    "statusCode"      TEXT,
    "embedding"       vector(768),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "cpt_codes_code_key" ON "cpt_codes" ("code");

CREATE INDEX "cpt_codes_embedding_idx"
  ON "cpt_codes" USING hnsw ("embedding" vector_cosine_ops);

-- ─── LCD / Article text chunks ──────────────────────────────

CREATE TABLE "lcd_text_chunks" (
    "id"         SERIAL PRIMARY KEY,
    "lcdId"      INTEGER,
    "articleId"  INTEGER,
    "section"    TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text"       TEXT NOT NULL,
    "embedding"  vector(768),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lcd_text_chunks_lcdId_fkey"
      FOREIGN KEY ("lcdId")     REFERENCES "lcds"         ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lcd_text_chunks_articleId_fkey"
      FOREIGN KEY ("articleId") REFERENCES "lcd_articles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "lcd_text_chunks_lcdId_section_idx"
  ON "lcd_text_chunks" ("lcdId", "section");
CREATE INDEX "lcd_text_chunks_articleId_section_idx"
  ON "lcd_text_chunks" ("articleId", "section");
CREATE INDEX "lcd_text_chunks_embedding_idx"
  ON "lcd_text_chunks" USING hnsw ("embedding" vector_cosine_ops);
