import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { SessionData } from "src/common/types/session.interface";
import { User } from "src/users/entities/user.entity";
import { UsersService } from "src/users/users.service";

export interface RequestWithSessionAndUser extends Request {
  session: SessionData | null;
  currentUser?: User;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithSessionAndUser>();

    const userId = request.session?.userId;
    if (!userId) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findByIdForAuth(userId);
    if (!user || user.deletedAt) {
      request.session = null;
      throw new UnauthorizedException(
        "User account has been deactivated or no longer exists",
      );
    }

    request.currentUser = user;
    return true;
  }
}
