import { IsEmail, IsNotEmpty, IsStrongPassword } from "class-validator";
import { CreateUserDto } from "src/users/dto/create-user.dto";

export class SignupDto extends CreateUserDto {
  @IsStrongPassword()
  password: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;
}
