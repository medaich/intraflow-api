import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { SessionData } from "../common/types/session.interface";
import { User } from "../users/entities/user.entity";
import { UsersService } from "../users/users.service";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";

export interface RequestWithSessionAndUser extends Request {
  session: SessionData | null;
  currentUser?: User;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly usersService: UsersService,
    private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector &&
      typeof context.getHandler === "function" &&
      typeof context.getClass === "function"
        ? this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
          ])
        : false;

    const request = context
      .switchToHttp()
      .getRequest<RequestWithSessionAndUser>();

    const userId = request.session?.userId;
    const iat = request.session?.iat;

    if (isPublic) {
      if (userId && iat) {
        const user = await this.usersService.findByIdForAuth(userId);
        if (user && !user.deletedAt) {
          if (
            !user.sessionsValidFrom ||
            iat >= new Date(user.sessionsValidFrom).getTime()
          ) {
            request.currentUser = user;
          }
        }
      }
      return true;
    }

    if (!userId || !iat) {
      request.session = null;
      throw new UnauthorizedException("Session invalid or expired");
    }

    const user = await this.usersService.findByIdForAuth(userId);
    if (!user || user.deletedAt) {
      request.session = null;
      throw new UnauthorizedException(
        "User account has been deactivated or no longer exists",
      );
    }

    if (user.sessionsValidFrom) {
      const validFromTime = new Date(user.sessionsValidFrom).getTime();
      if (iat < validFromTime) {
        request.session = null;
        throw new UnauthorizedException(
          "Session has been invalidated due to password or security update",
        );
      }
    }

    request.currentUser = user;
    return true;
  }
}

