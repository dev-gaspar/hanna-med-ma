import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { S3Module } from "../core/s3.module";
import { CodingController } from "./coding.controller";
import { CodingService } from "./coding.service";

/**
 * AI Coder HTTP surface + persistence. Delegates the LLM work to
 * CoderAgent (in AiModule) and the PDF download to S3Service.
 */
@Module({
  imports: [AiModule, S3Module],
  controllers: [CodingController],
  providers: [CodingService],
  exports: [CodingService],
})
export class CodingModule {}
