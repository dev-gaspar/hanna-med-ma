import { Module } from "@nestjs/common";
import { CoverageController } from "./coverage.controller";
import { CoverageService } from "./coverage.service";

/**
 * Regulatory engine — Medicare MPFS today, LCD / NCCI / MUE next.
 * Exports the service so the AI Coder agent can resolve fees and
 * rules without going through HTTP.
 */
@Module({
  controllers: [CoverageController],
  providers: [CoverageService],
  exports: [CoverageService],
})
export class CoverageModule {}
