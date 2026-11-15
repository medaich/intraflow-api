import { Module, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import { User } from "../users/entities/user.entity";
import { AdminSeedService } from "./admin-seed.service";
import { AuthModule } from "../auth/auth.module";

export const databaseConfigFactory = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: "mysql",
  host: configService.getOrThrow<string>("MYSQL_HOST"),
  port: Number(configService.getOrThrow("MYSQL_PORT")),
  database: configService.getOrThrow<string>("MYSQL_DATABASE"),
  username: configService.getOrThrow<string>("MYSQL_USERNAME"),
  password: configService.getOrThrow<string>("MYSQL_ROOT_PASSWORD"),
  timezone: "Z",
  autoLoadEntities: true,
  synchronize: false,
});

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: databaseConfigFactory,
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User]),
    forwardRef(() => AuthModule),
  ],
  providers: [AdminSeedService],
  exports: [AdminSeedService],
})
export class DatabaseModule {}
