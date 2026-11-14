import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import cookieSession from "cookie-session";
import { Express } from "express";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);

  app.useLogger(app.get(Logger));

  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.set("trust proxy", 1);

  app.use(helmet());

  const corsOrigin = configService.get<string>("CORS_ORIGIN");
  app.enableCors({
    origin: corsOrigin ? [corsOrigin] : false,
    credentials: true,
  });

  app.use(
    cookieSession({
      name: "session",
      keys: [configService.getOrThrow<string>("COOKIE_KEY")],
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: configService.get<string>("NODE_ENV") === "production",
      sameSite: "lax",
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Intraflow API")
    .setDescription("Role-based task coordination and internal operations API")
    .setVersion("1.0")
    .addCookieAuth("session", {
      type: "apiKey",
      in: "cookie",
      name: "session",
      description: "Encrypted session cookie",
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  const port = configService.get<number>("PORT") ?? 3000;
  await app.listen(port);
}
void bootstrap();
