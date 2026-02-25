import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { setupSwagger } from "./config/swagger.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger("Bootstrap");

  // Enable CORS
  app.enableCors();

  // Increase JSON/body size limit to handle RPA raw summaries/insurances
  // (13+ patients with long clinical notes can easily exceed 100kb)
  app.use(
    json({
      limit: "2mb",
    }),
  );
  app.use(
    urlencoded({
      limit: "2mb",
      extended: true,
    }),
  );

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Setup Swagger documentation
  setupSwagger(app);

  const port = process.env.SERVER_PORT || 3001;
  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📚 API Documentation: http://localhost:${port}/docs`);
}
bootstrap();
