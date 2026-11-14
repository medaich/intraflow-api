import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { UserRole } from "src/users/entities/user.entity";
import { UsersService } from "src/users/users.service";
import { RequestWithSessionAndUser } from "./auth.guard";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Optional()
    private readonly usersService?: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithSessionAndUser>();

    const userId = request.session?.userId;
    if (!userId) {
      throw new UnauthorizedException();
    }

    if (!request.currentUser && this.usersService) {
      const user = await this.usersService.findByIdForAuth(userId);
      if (!user || user.deletedAt) {
        request.session = null;
        throw new UnauthorizedException();
      }
      request.currentUser = user;
    }

    const currentUser = request.currentUser;
    if (!currentUser) {
      throw new UnauthorizedException();
    }

    if (currentUser.role !== UserRole.ADMIN) {
      throw new ForbiddenException();
    }

    return true;
  }
}
