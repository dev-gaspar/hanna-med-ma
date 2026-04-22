import { Module } from "@nestjs/common";
import { IngestModule } from "../ingest/ingest.module";
import { RpaModule } from "../rpa/rpa.module";
import { S3Module } from "../core/s3.module";
import { PatientsController } from "./patients.controller";

/**
 * Doctor-facing patient endpoints.
 * Delegates to IngestService (list/query), RpaService (seen/mark-seen),
 * and S3Service (presigned URLs for face sheet / provider note PDFs).
 */
@Module({
  imports: [IngestModule, RpaModule, S3Module],
  controllers: [PatientsController],
})
export class PatientsModule {}
