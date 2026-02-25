import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./core/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { DoctorsModule } from "./doctors/doctors.module";
import { UsersModule } from "./users/users.module";
import { CredentialsModule } from "./credentials/credentials.module";
import { LoggerMiddleware } from "./common/middleware/logger.middleware";
import { ChatModule } from "./chat/chat.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { RpaModule } from "./rpa/rpa.module";
import { IngestModule } from "./ingest/ingest.module";
import { AiModule } from "./ai/ai.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    DoctorsModule,
    UsersModule,
    CredentialsModule,
    ChatModule,
    NotificationsModule,
    RpaModule,
    IngestModule,
    AiModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes("*");
  }
}
