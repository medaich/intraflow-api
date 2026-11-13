import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { SessionData } from "src/common/types/session.interface";

interface RequestWithSession extends Request {
  session: SessionData;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithSession>();

    if (!request.session?.userId) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
