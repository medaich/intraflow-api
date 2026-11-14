import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin-auth.guard';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/entities/user.entity';

describe('AuthGuard and AdminGuard (Session Handling & Single Hydration)', () => {
  let mockUsersService: jest.Mocked<Partial<UsersService>>;

  beforeEach(() => {
    mockUsersService = {
      findByIdForAuth: jest.fn(),
    };
  });

  describe('AuthGuard Session Edge Cases', () => {
    it('throws 401 when request.session is undefined (original crash reproduction)', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when request.session is empty object', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ session: {} }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when user in session has been soft-deleted or does not exist in DB', async () => {
      const guard = new AuthGuard(mockUsersService as UsersService);
      const req: Record<string, unknown> = { session: { userId: 99 } };
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
    it('AuthGuard populates request.currentUser and AdminGuard reuses it (exactly 1 DB lookup)', async () => {
      const dbUser = new User({
        userId: 10,
        email: 'admin@intraflow.dev',
        role: UserRole.ADMIN,
      });
      mockUsersService.findByIdForAuth!.mockResolvedValue(dbUser);

      const requestObj: Record<string, unknown> = {
        session: { userId: 10 },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => requestObj,
        }),
      } as unknown as ExecutionContext;

      const authGuard = new AuthGuard(mockUsersService as UsersService);
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
