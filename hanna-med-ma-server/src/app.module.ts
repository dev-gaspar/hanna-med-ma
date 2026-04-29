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
import { PatientsModule } from "./patients/patients.module";
import { AiModule } from "./ai/ai.module";
import { CoverageModule } from "./coverage/coverage.module";
import { CodingModule } from "./coding/coding.module";
import { RedactionModule } from "./redaction/redaction.module";
import { SpecialtiesModule } from "./specialties/specialties.module";
import { PlaceOfServiceModule } from "./place-of-service/place-of-service.module";
import { RedisModule } from "./core/redis.module";
import { S3Module } from "./core/s3.module";

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
    PatientsModule,
    AiModule,
    CoverageModule,
    CodingModule,
    RedactionModule,
    SpecialtiesModule,
    PlaceOfServiceModule,
    RedisModule,
    S3Module,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes("*");
  }
}
