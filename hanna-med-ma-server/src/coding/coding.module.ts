import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { CodingController } from "./coding.controller";

/**
 * AI Coder HTTP surface. Delegates to CoderAgent (in AiModule) so the
 * agent wiring stays with the rest of the AI code.
 */
@Module({
	imports: [AiModule],
	controllers: [CodingController],
})
export class CodingModule {}
