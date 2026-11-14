import {
  Body,
  Controller,
  HttpCode,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Session,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { SessionData } from "src/common/types/session.interface";
import { AuthGuard } from "src/guards/auth.guard";
import { AuthService } from "./auth.service";
import { SigninDto } from "./dto/signin.dto";
import { SignupDto } from "./dto/signup.dto";

interface RequestWithSession extends Request {
  session: SessionData | null;
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: "Register a new user using a valid invitation token" })
  @ApiQuery({ name: "token", type: "string", description: "UUID invitation token" })
  @ApiResponse({ status: 201, description: "User successfully registered" })
  @ApiResponse({ status: 400, description: "Validation error or email mismatch" })
  @ApiResponse({ status: 404, description: "Invitation token not found" })
  @ApiResponse({ status: 410, description: "Invitation token has expired" })
  @Post("signup")
  async signup(
    @Query("token", ParseUUIDPipe) token: string,
    @Body() signupDto: SignupDto,
    @Session() session: SessionData,
  ) {
    const user = await this.authService.signup(token, signupDto);
    session.userId = user.userId;
    session.role = user.role;

    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  @ApiOperation({ summary: "Sign in with email and password" })
  @ApiResponse({ status: 201, description: "Successfully authenticated" })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("signin")
  async signin(@Body() signinDto: SigninDto, @Session() session: SessionData) {
    const user = await this.authService.signin(signinDto);
    session.userId = user.userId;
    session.role = user.role;

    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  @ApiOperation({ summary: "Sign out and invalidate session cookie" })
  @ApiResponse({ status: 200, description: "Successfully signed out" })
  @UseGuards(AuthGuard)
  @Post("signout")
  @HttpCode(200)
  signout(@Req() req: RequestWithSession) {
    req.session = null;
  }
}
