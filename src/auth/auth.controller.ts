import {
  Body,
  Controller,
  HttpCode,
  ParseUUIDPipe,
  Post,
  Query,
  Session,
  UseGuards,
} from "@nestjs/common";
import { SessionData } from "src/common/types/session.interface";
import { AuthGuard } from "src/guards/auth.guard";
import { UserRole } from "src/users/entities/user.entity";
import { UsersService } from "src/users/users.service";
import { AuthService } from "./auth.service";
import { SigninDto } from "./dto/signin.dto";
import { SignupDto } from "./dto/signup.dto";

@Controller("auth")
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post("signup")
  async signup(
    @Query("token", ParseUUIDPipe) token: string,
    @Body() signupDto: SignupDto,
    @Session() session: SessionData,
  ) {
    const isValid = await this.usersService.checkInvite(token, signupDto.email);
    if (isValid) {
      const user = await this.authService.signup(signupDto);
      session.userId = user.userId;
      session.role = UserRole.EMPLOYEE;
      return user;
    }
  }

  /* @Post("signuptest")
  async signupTest(@Body() signupDto: CreateUserDto) {
    const user = await this.authService.signup(signupDto);
    return user
  } */

  @Post("signin")
  async signin(@Body() signinDto: SigninDto, @Session() session: SessionData) {
    const user = await this.authService.signin(signinDto);
    if (user) {
      session.userId = user.userId;
      session.role = user.role;
      return user;
    }
  }

  @UseGuards(AuthGuard)
  @Post("signout")
  @HttpCode(200)
  signout(@Session() session: SessionData) {
    session.userId = null;
    session.role = null;
  }
}
