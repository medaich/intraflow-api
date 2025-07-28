import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { UsersService } from "../users.service";
import { Request } from "express";
import { SessionData } from "src/common/types/session.interface";
import { User } from "../entities/user.entity";

interface RequestWithSession extends Request {
  session: SessionData;
  currentUser?: User;
}

@Injectable()
export class CurrentUserInterceptor implements NestInterceptor {
  constructor(private usersService: UsersService) {}

  async intercept(context: ExecutionContext, handler: CallHandler) {
    const request = context.switchToHttp().getRequest<RequestWithSession>();

    const userId = request?.session?.userId ?? null;

    let currentUser;

    if (userId) {
      try {
        currentUser = await this.usersService.findOne({ userId });
      } catch {
        currentUser = undefined;
      }
    }

    request.currentUser = currentUser
      ? { ...currentUser, password: undefined }
      : undefined;

    return handler.handle();
  }
}
