import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { CommonModule } from "./common/common.module";
import { GlobalExceptionsFilter } from "./common/filters/global-exceptions.filter";
import { UsersModule } from "./users/users.module";
import { DatabaseModule } from "./database/database.module";
import { TasksModule } from "./tasks/tasks.module";
import { TeamsModule } from "./teams/teams.module";
import { ProjectsModule } from "./projects/projects.module";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { MailModule } from "./mail/mail.module";
import { StorageModule } from "./storage/storage.module";
import { envValidationSchema } from "./config/env.validation";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === "test" ? ".env.test" : ".env",
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { singleLine: true } }
            : undefined,
        autoLogging: {
          ignore: (req) => req.url === "/health",
        },
        serializers: {
          req(req: { url?: string }) {
            if (req.url) {
              req.url = req.url.replace(/([?&]token=)[^&]+/gi, "$1[REDACTED]");
            }
            return req;
          },
        },
        redact: {
          paths: [
            "req.headers.cookie",
            "req.headers['set-cookie']",
            "res.headers['set-cookie']",
            "req.headers.authorization",
            "req.query.token",
            "req.params.token",
            "req.body.password",
            "req.body.currentPassword",
            "req.body.newPassword",
            "req.body.token",
            "*.password",
            "*.currentPassword",
            "*.newPassword",
            "*.token",
          ],
          censor: "[REDACTED]",
        },
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60000,
        limit: 100,
      },
    ]),
    CommonModule,
    MailModule,
    StorageModule,
    DatabaseModule,
    UsersModule,
    TeamsModule,
    ProjectsModule,
    TasksModule,
    AuthModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionsFilter,
    },
  ],
})
export class AppModule {}
