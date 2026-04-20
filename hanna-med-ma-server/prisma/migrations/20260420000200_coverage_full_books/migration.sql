-- CreateTable
CREATE TABLE "ncci_edits" (
    "id" SERIAL NOT NULL,
    "column1Cpt" TEXT NOT NULL,
    "column2Cpt" TEXT NOT NULL,
    "priorTo1996" BOOLEAN NOT NULL DEFAULT false,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "deletionDate" TIMESTAMP(3),
    "modifierIndicator" TEXT NOT NULL,
    "rationale" TEXT,
    "editType" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ncci_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mue_limits" (
    "id" SERIAL NOT NULL,
    "cpt" TEXT NOT NULL,
    "mueValue" INTEGER NOT NULL,
    "adjudicationIndicator" TEXT NOT NULL,
    "mai" TEXT NOT NULL,
    "rationale" TEXT,
    "serviceType" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mue_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lcds" (
    "id" SERIAL NOT NULL,
    "lcdId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "displayId" TEXT,
    "status" TEXT,
    "origEffectiveDate" TIMESTAMP(3),
    "revEffectiveDate" TIMESTAMP(3),
    "lastUpdated" TIMESTAMP(3),
    "mcdPublishDate" TIMESTAMP(3),
    "indication" TEXT,
    "indicationPlain" TEXT,
    "codingGuidelines" TEXT,
    "codingGuidelinesPlain" TEXT,
    "docReqs" TEXT,
    "docReqsPlain" TEXT,
    "utilGuide" TEXT,
    "utilGuidePlain" TEXT,
    "summaryOfEvidence" TEXT,
    "summaryOfEvidencePlain" TEXT,
    "analysisOfEvidence" TEXT,
    "analysisOfEvidencePlain" TEXT,
    "diagnosesSupport" TEXT,
    "diagnosesSupportPlain" TEXT,
    "bibliography" TEXT,
    "bibliographyPlain" TEXT,
    "keywords" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lcds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lcd_contractors" (
    "id" SERIAL NOT NULL,
    "lcdId" INTEGER NOT NULL,
    "contractorNumber" TEXT NOT NULL,
    "contractorName" TEXT,
    "jurisdiction" TEXT,

    CONSTRAINT "lcd_contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lcd_articles" (
    "id" SERIAL NOT NULL,
    "articleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "articleType" TEXT,
    "displayId" TEXT,
    "status" TEXT,
    "origEffectiveDate" TIMESTAMP(3),
    "revEffectiveDate" TIMESTAMP(3),
    "lastUpdated" TIMESTAMP(3),
    "description" TEXT,
    "descriptionPlain" TEXT,
    "otherComments" TEXT,
    "otherCommentsPlain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lcd_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lcd_article_contractors" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "contractorNumber" TEXT NOT NULL,
    "contractorName" TEXT,
    "jurisdiction" TEXT,

    CONSTRAINT "lcd_article_contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lcd_article_links" (
    "id" SERIAL NOT NULL,
    "lcdId" INTEGER NOT NULL,
    "articleId" INTEGER NOT NULL,

    CONSTRAINT "lcd_article_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lcd_article_cpts" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "cpt" TEXT NOT NULL,
    "description" TEXT,
    "sequence" INTEGER,

    CONSTRAINT "lcd_article_cpts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lcd_article_icd10s" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "icd10" TEXT NOT NULL,
    "coverage" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "lcd_article_icd10s_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ncci_edits_column1Cpt_deletionDate_idx" ON "ncci_edits"("column1Cpt", "deletionDate");

-- CreateIndex
CREATE INDEX "ncci_edits_column2Cpt_deletionDate_idx" ON "ncci_edits"("column2Cpt", "deletionDate");

-- CreateIndex
CREATE UNIQUE INDEX "ncci_edits_column1Cpt_column2Cpt_editType_effectiveDate_key" ON "ncci_edits"("column1Cpt", "column2Cpt", "editType", "effectiveDate");

-- CreateIndex
CREATE INDEX "mue_limits_cpt_idx" ON "mue_limits"("cpt");

-- CreateIndex
CREATE UNIQUE INDEX "mue_limits_cpt_serviceType_effectiveDate_key" ON "mue_limits"("cpt", "serviceType", "effectiveDate");

-- CreateIndex
CREATE INDEX "lcds_status_idx" ON "lcds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "lcds_lcdId_version_key" ON "lcds"("lcdId", "version");

-- CreateIndex
CREATE INDEX "lcd_contractors_contractorNumber_idx" ON "lcd_contractors"("contractorNumber");

-- CreateIndex
CREATE UNIQUE INDEX "lcd_contractors_lcdId_contractorNumber_key" ON "lcd_contractors"("lcdId", "contractorNumber");

-- CreateIndex
CREATE UNIQUE INDEX "lcd_articles_articleId_version_key" ON "lcd_articles"("articleId", "version");

-- CreateIndex
CREATE INDEX "lcd_article_contractors_contractorNumber_idx" ON "lcd_article_contractors"("contractorNumber");

-- CreateIndex
CREATE UNIQUE INDEX "lcd_article_contractors_articleId_contractorNumber_key" ON "lcd_article_contractors"("articleId", "contractorNumber");

-- CreateIndex
CREATE UNIQUE INDEX "lcd_article_links_lcdId_articleId_key" ON "lcd_article_links"("lcdId", "articleId");

-- CreateIndex
CREATE INDEX "lcd_article_cpts_cpt_idx" ON "lcd_article_cpts"("cpt");

-- CreateIndex
CREATE INDEX "lcd_article_cpts_articleId_idx" ON "lcd_article_cpts"("articleId");

-- CreateIndex
CREATE INDEX "lcd_article_icd10s_icd10_idx" ON "lcd_article_icd10s"("icd10");

-- CreateIndex
CREATE INDEX "lcd_article_icd10s_articleId_coverage_idx" ON "lcd_article_icd10s"("articleId", "coverage");

-- AddForeignKey
ALTER TABLE "lcd_contractors" ADD CONSTRAINT "lcd_contractors_lcdId_fkey" FOREIGN KEY ("lcdId") REFERENCES "lcds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lcd_article_contractors" ADD CONSTRAINT "lcd_article_contractors_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "lcd_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lcd_article_links" ADD CONSTRAINT "lcd_article_links_lcdId_fkey" FOREIGN KEY ("lcdId") REFERENCES "lcds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lcd_article_links" ADD CONSTRAINT "lcd_article_links_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "lcd_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lcd_article_cpts" ADD CONSTRAINT "lcd_article_cpts_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "lcd_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lcd_article_icd10s" ADD CONSTRAINT "lcd_article_icd10s_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "lcd_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

