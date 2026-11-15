import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class ChangeEmailDto {
  @Transform(({ value }: { value: unknown }): string =>
    typeof value === "string" ? value.trim().toLowerCase() : (value as string),
  )
  @IsEmail()
  @IsNotEmpty()
  newEmail: string;

  @IsString()
  @IsNotEmpty()
  currentPassword: string;
}

