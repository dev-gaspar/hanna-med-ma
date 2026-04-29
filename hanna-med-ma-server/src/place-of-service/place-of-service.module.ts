import { Module } from "@nestjs/common";
import { PlaceOfServiceController } from "./place-of-service.controller";
import { PlaceOfServiceService } from "./place-of-service.service";

@Module({
  controllers: [PlaceOfServiceController],
  providers: [PlaceOfServiceService],
  exports: [PlaceOfServiceService],
})
export class PlaceOfServiceModule {}
