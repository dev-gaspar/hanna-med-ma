import { Module } from "@nestjs/common";
import { IngestController } from "./ingest.controller";
import { IngestService } from "./ingest.service";
import { PatientSyncService } from "./patient-sync.service";

@Module({
  controllers: [IngestController],
  providers: [IngestService, PatientSyncService],
  exports: [IngestService, PatientSyncService],
})
export class IngestModule {}
