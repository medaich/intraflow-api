import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { SessionData } from "../common/types/session.interface";
import { AuthGuard } from "../guards/auth.guard";
import { AuthService } from "./auth.service";
import { SigninDto } from "./dto/signin.dto";
import { SignupDto } from "./dto/signup.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";

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
    session.iat = Date.now();

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
    session.iat = Date.now();

    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  @ApiOperation({ summary: "Request password reset email" })
  @ApiResponse({ status: 202, description: "Password reset request accepted" })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @ApiOperation({ summary: "Reset password using reset token" })
  @ApiResponse({ status: 200, description: "Password successfully reset" })
  @ApiResponse({ status: 400, description: "Invalid or expired token" })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
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

