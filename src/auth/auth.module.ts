import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthService } from "./auth.service";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { PasswordResetToken } from "./entities/password-reset-token.entity";

@Module({
  providers: [AuthService],
  imports: [UsersModule, TypeOrmModule.forFeature([PasswordResetToken])],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}

