import { Module } from "@nestjs/common";
import { RpaController } from "./rpa.controller";
import { RpaService } from "./rpa.service";
import { CredentialsModule } from "../credentials/credentials.module";

@Module({
  imports: [CredentialsModule],
  controllers: [RpaController],
  providers: [RpaService],
  exports: [RpaService],
})
export class RpaModule {}
