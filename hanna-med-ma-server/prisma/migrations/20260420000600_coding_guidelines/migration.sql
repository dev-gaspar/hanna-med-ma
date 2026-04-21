-- ICD-10-CM Official Guidelines — chunked + embedded so the AI Coder
-- can cite authoritative coding rules (combination codes, sequencing,
-- "code also" / "use additional code" mandates) in context.

CREATE TABLE "coding_guidelines" (
    "id"          SERIAL PRIMARY KEY,
    "sourceYear"  INTEGER NOT NULL,
    "section"     TEXT NOT NULL,
    "heading"     TEXT,
    "chunkIndex"  INTEGER NOT NULL,
    "text"        TEXT NOT NULL,
    "embedding"   vector(768),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL
);

CREATE INDEX "coding_guidelines_sourceYear_section_idx"
  ON "coding_guidelines" ("sourceYear", "section");

CREATE INDEX "coding_guidelines_embedding_idx"
  ON "coding_guidelines" USING hnsw ("embedding" vector_cosine_ops);
