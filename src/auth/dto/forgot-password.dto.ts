import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty } from "class-validator";

export class ForgotPasswordDto {
  @Transform(({ value }: { value: unknown }): string =>
    typeof value === "string" ? value.trim().toLowerCase() : (value as string),
  )
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

