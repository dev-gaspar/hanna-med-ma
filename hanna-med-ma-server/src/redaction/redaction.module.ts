import { Global, Module } from "@nestjs/common";
import { RedactionService } from "./redaction.service";

// Global so any module can inject RedactionService without importing
// RedactionModule explicitly. The service is pure (no state, no deps).
@Global()
@Module({
	providers: [RedactionService],
	exports: [RedactionService],
})
export class RedactionModule {}
