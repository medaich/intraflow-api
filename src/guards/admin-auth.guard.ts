import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { SessionData } from "src/common/types/session.interface";
import { UserRole } from "src/users/entities/user.entity";

interface RequestWithSession extends Request {
  session: SessionData;
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const session = request.session;

    if (!session?.userId) {
      throw new UnauthorizedException();
    }

    if (session.role !== UserRole.ADMIN) {
      throw new ForbiddenException();
    }

    return true;
  }
}
