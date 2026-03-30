import { Module } from "@nestjs/common";
import { RpaController } from "./rpa.controller";
import { RpaService } from "./rpa.service";
import { CredentialsModule } from "../credentials/credentials.module";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [CredentialsModule, AiModule],
  controllers: [RpaController],
  providers: [RpaService],
  exports: [RpaService],
})
export class RpaModule {}
