import { IsEmail, IsEnum, IsOptional } from "class-validator";
import { UserRole } from "../entities/user.entity";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class InviteDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.EMPLOYEE })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
