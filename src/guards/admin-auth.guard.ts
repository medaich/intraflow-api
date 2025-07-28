import { CanActivate, ExecutionContext } from "@nestjs/common";
import { UserRole } from "src/users/entities/user.entity";

export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const session = request.session;

    return session.userId && session.role === UserRole.ADMIN;
  }
}
