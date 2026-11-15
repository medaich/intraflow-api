import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin-auth.guard';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/entities/user.entity';

describe('AuthGuard and AdminGuard (Session Handling & Single Hydration)', () => {
  let mockUsersService: jest.Mocked<Partial<UsersService>>;
  let mockReflector: jest.Mocked<Partial<Reflector>>;

  beforeEach(() => {
    mockUsersService = {
      findByIdForAuth: jest.fn(),
    };
    mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
  });

  describe('AuthGuard Session Edge Cases', () => {
    it('throws 401 when request.session is undefined (original crash reproduction)', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService, mockReflector as Reflector);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when request.session is empty object', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService, mockReflector as Reflector);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ session: {} }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when session has userId but lacks iat (forced re-login)', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService, mockReflector as Reflector);
      const req: Record<string, unknown> = { session: { userId: 99 } };
      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(req.session).toBeNull();
    });

    it('throws 401 when session iat is before user sessionsValidFrom', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService, mockReflector as Reflector);
      const req: Record<string, unknown> = {
        session: { userId: 99, iat: 1000 },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as unknown as ExecutionContext;

      mockUsersService.findByIdForAuth!.mockResolvedValue(
        new User({ userId: 99, sessionsValidFrom: new Date(2000) }),
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(req.session).toBeNull();
    });

    it('allows access when session iat is after user sessionsValidFrom', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService, mockReflector as Reflector);
      const req: Record<string, unknown> = {
        session: { userId: 99, iat: 3000 },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as unknown as ExecutionContext;

      mockUsersService.findByIdForAuth!.mockResolvedValue(
        new User({ userId: 99, sessionsValidFrom: new Date(2000) }),
      );

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(req.currentUser).toBeDefined();
    });

    it('throws 401 when user in session has been soft-deleted or does not exist in DB', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService, mockReflector as Reflector);
      const req: Record<string, unknown> = { session: { userId: 99, iat: Date.now() } };
      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as unknown as ExecutionContext;

      mockUsersService.findByIdForAuth!.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(req.session).toBeNull();
    });
  });

  describe('AdminGuard Role & Session Checks', () => {
    it('throws 401 when request.session is undefined', async () => {
      const guard = new AdminGuard();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when session exists but has no userId', async () => {
      const guard = new AdminGuard();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ session: {} }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('throws 403 ForbiddenException when user has EMPLOYEE role', async () => {
      const guard = new AdminGuard();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            session: { userId: 1, role: UserRole.EMPLOYEE },
            currentUser: new User({ userId: 1, role: UserRole.EMPLOYEE }),
          }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('returns true when user has ADMIN role', async () => {
      const guard = new AdminGuard();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            session: { userId: 1, role: UserRole.ADMIN },
            currentUser: new User({ userId: 1, role: UserRole.ADMIN }),
          }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('Single Request Hydration Guarantee', () => {
    it('AuthGuard populates request.currentUser with membership and AdminGuard reuses it (exactly 1 DB lookup)', async () => {
      const dbUser = new User({
        userId: 10,
        email: 'employee@intraflow.dev',
        role: UserRole.EMPLOYEE,
        membership: {
          id: 5,
          userId: 10,
          teamId: 1,
          role: 'MODERATOR' as any,
          createdAt: new Date(),
        } as any,
      });
      mockUsersService.findByIdForAuth!.mockResolvedValue(dbUser);

      const requestObj: Record<string, unknown> = {
        session: { userId: 10, iat: Date.now() },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => requestObj,
        }),
      } as unknown as ExecutionContext;

      const authGuard = new AuthGuard(mockUsersService as UsersService, mockReflector as Reflector);

      // 1. AuthGuard activates
      const authResult = await authGuard.canActivate(context);
      expect(authResult).toBe(true);
      expect(requestObj.currentUser).toBe(dbUser);
      expect((requestObj.currentUser as User).membership?.teamId).toBe(1);
      expect((requestObj.currentUser as User).membership?.role).toBe('MODERATOR');
      expect(mockUsersService.findByIdForAuth).toHaveBeenCalledTimes(1);
    });

    it('AuthGuard populates request.currentUser and AdminGuard reuses it (exactly 1 DB lookup)', async () => {
      const dbUser = new User({
        userId: 10,
        email: 'admin@intraflow.dev',
        role: UserRole.ADMIN,
      });
      mockUsersService.findByIdForAuth!.mockResolvedValue(dbUser);

      const requestObj: Record<string, unknown> = {
        session: { userId: 10, iat: Date.now() },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => requestObj,
        }),
      } as unknown as ExecutionContext;

      const authGuard = new AuthGuard(mockUsersService as UsersService, mockReflector as Reflector);
      const adminGuard = new AdminGuard(mockUsersService as UsersService);

      // 1. AuthGuard activates first
      const authResult = await authGuard.canActivate(context);
      expect(authResult).toBe(true);
      expect(requestObj.currentUser).toBe(dbUser);
      expect(mockUsersService.findByIdForAuth).toHaveBeenCalledTimes(1);

      // 2. AdminGuard activates next in the pipeline
      const adminResult = await adminGuard.canActivate(context);
      expect(adminResult).toBe(true);

      // Verifies AdminGuard re-used request.currentUser and DID NOT invoke DB a second time
      expect(mockUsersService.findByIdForAuth).toHaveBeenCalledTimes(1);
    });
  });
});
