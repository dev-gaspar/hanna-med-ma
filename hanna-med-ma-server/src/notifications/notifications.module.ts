import { Module, Global } from "@nestjs/common";
import { FcmService } from "./fcm.service";
import { NotificationsController } from "./notifications.controller";

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [FcmService],
  exports: [FcmService],
})
export class NotificationsModule {}
