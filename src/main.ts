import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import cookieSession from "cookie-session";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);

  app.enableShutdownHooks();
  app.useLogger(app.get(Logger));

  const trustProxy = configService.get<number>("TRUST_PROXY", 0);
  app.set("trust proxy", trustProxy);
  app.useBodyParser("json", { limit: "1mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "1mb" });

  app.use(helmet());

  const corsOrigin = configService.get<string>("CORS_ORIGIN");
  app.enableCors({
    origin: corsOrigin ? [corsOrigin] : false,
    credentials: true,
  });

  const cookieSecure = configService.get<boolean>("COOKIE_SECURE") ?? false;

  app.use(
    cookieSession({
      name: "session",
      keys: [configService.getOrThrow<string>("COOKIE_KEY")],
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: cookieSecure,
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
      description: "Signed session cookie",
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  const port = configService.get<number>("PORT") ?? 3000;
  await app.listen(port);
}
void bootstrap();
