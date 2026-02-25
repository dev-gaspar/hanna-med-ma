import { Module } from "@nestjs/common";
import { CredentialsService } from "./credentials.service";
import { CredentialsController } from "./credentials.controller";
import { PrismaService } from "../core/prisma.service";

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, PrismaService],
  exports: [CredentialsService],
})
export class CredentialsModule {}
