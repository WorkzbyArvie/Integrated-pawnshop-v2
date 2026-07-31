import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RbacGuard } from './rbac.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from '../decorators/requires-permission.decorator';
import { PermissionService } from '../permissions/permissions.service';
import type { PrismaService } from '../../prisma.service';
import type { AuthUserService } from '../auth-user.service';

describe('RbacGuard', () => {
  let prisma: { profile: { findUnique: jest.Mock } };
  let authUser: { getUserIdFromAuthHeader: jest.Mock };
  let permissionService: { resolveEffectivePermissions: jest.Mock };
  let metadata: Record<string, unknown>;
  let request: { headers: Record<string, string | undefined>; user?: unknown };

  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };

  const buildGuard = () =>
    new RbacGuard(
      reflector,
      prisma as unknown as PrismaService,
      authUser as unknown as AuthUserService,
      permissionService as unknown as PermissionService,
    );

  beforeEach(() => {
    metadata = {};
    request = { headers: { authorization: 'Bearer token' } };
    prisma = { profile: { findUnique: jest.fn() } };
    authUser = { getUserIdFromAuthHeader: jest.fn().mockResolvedValue('user-1') };
    permissionService = { resolveEffectivePermissions: jest.fn() };
  });

  it('(a) allows @Public without resolving the user', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(authUser.getUserIdFromAuthHeader).not.toHaveBeenCalled();
  });

  it('(b) allows undecorated endpoints and populates request.user with staffType', async () => {
    prisma.profile.findUnique.mockResolvedValue({
      role: 'MANAGER',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      role: 'MANAGER',
      staffType: null,
      pawnshopId: 'ps-1',
    });
  });

  it('(c) bypasses permission lookup for SUPER_ADMIN on @RequiresPermission endpoints', async () => {
    metadata[PERMISSIONS_KEY] = ['platform.manage'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'SUPER_ADMIN',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(permissionService.resolveEffectivePermissions).not.toHaveBeenCalled();
    expect(request.user).toMatchObject({ role: 'SUPER_ADMIN', staffType: null });
  });

  it('(d) bypasses for SUPER_ADMIN on @Roles endpoints', async () => {
    metadata[ROLES_KEY] = ['OWNER'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'SUPER_ADMIN',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
  });

  it('(e) normalizes legacy role=CASHIER_TELLER before permission resolution', async () => {
    metadata[PERMISSIONS_KEY] = ['pawn_ticket.redeem'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'CASHIER_TELLER',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    permissionService.resolveEffectivePermissions.mockResolvedValue(
      new Set(['pawn_ticket.redeem']),
    );
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(permissionService.resolveEffectivePermissions).toHaveBeenCalledWith(
      'STAFF',
      'CASHIER_TELLER',
    );
    expect(request.user).toMatchObject({ staffType: 'CASHIER_TELLER' });
  });

  it('(f) resolves normalized STAFF+staffType the same way as legacy shape', async () => {
    metadata[PERMISSIONS_KEY] = ['pawn_ticket.redeem'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'STAFF',
      staffType: 'CASHIER_TELLER',
      pawnshopId: 'ps-1',
    });
    permissionService.resolveEffectivePermissions.mockResolvedValue(
      new Set(['pawn_ticket.redeem']),
    );
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(permissionService.resolveEffectivePermissions).toHaveBeenCalledWith(
      'STAFF',
      'CASHIER_TELLER',
    );
  });

  it('(g) denies generic STAFF appraise (deliberate tightening)', async () => {
    metadata[PERMISSIONS_KEY] = ['pawn_ticket.appraise'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'STAFF',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    permissionService.resolveEffectivePermissions.mockResolvedValue(new Set(['pawn_ticket.view']));
    await expect(buildGuard().canActivate(context as never)).rejects.toThrow(ForbiddenException);
  });

  it('(h) allows APPRAISER with the appraise permission', async () => {
    metadata[PERMISSIONS_KEY] = ['pawn_ticket.appraise'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'STAFF',
      staffType: 'APPRAISER',
      pawnshopId: 'ps-1',
    });
    permissionService.resolveEffectivePermissions.mockResolvedValue(
      new Set(['pawn_ticket.view', 'pawn_ticket.appraise']),
    );
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
    expect(request.user).toMatchObject({ staffType: 'APPRAISER' });
  });

  it('(i) keeps the @Roles-only fallback fail-closed', async () => {
    metadata[ROLES_KEY] = ['MANAGER', 'OWNER'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'MANAGER',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);

    prisma.profile.findUnique.mockResolvedValue({
      role: 'STAFF',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    await expect(buildGuard().canActivate(context as never)).rejects.toThrow(ForbiddenException);
    expect(permissionService.resolveEffectivePermissions).not.toHaveBeenCalled();
  });

  it('(j) lets the permission path win when both decorators are present', async () => {
    metadata[ROLES_KEY] = ['MANAGER', 'OWNER'];
    metadata[PERMISSIONS_KEY] = ['pawn_ticket.view'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'STAFF',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    permissionService.resolveEffectivePermissions.mockResolvedValue(new Set(['pawn_ticket.view']));
    await expect(buildGuard().canActivate(context as never)).resolves.toBe(true);
  });

  it('(k) throws 401 on invalid or missing token', async () => {
    authUser.getUserIdFromAuthHeader.mockRejectedValue(
      new UnauthorizedException('Invalid or missing authentication token'),
    );
    await expect(buildGuard().canActivate(context as never)).rejects.toThrow(UnauthorizedException);
  });

  it('(l) fails closed for unknown roles (empty permission set)', async () => {
    metadata[PERMISSIONS_KEY] = ['pawn_ticket.view'];
    prisma.profile.findUnique.mockResolvedValue({
      role: 'MYSTERY_ROLE',
      staffType: null,
      pawnshopId: 'ps-1',
    });
    permissionService.resolveEffectivePermissions.mockResolvedValue(new Set());
    await expect(buildGuard().canActivate(context as never)).rejects.toThrow(ForbiddenException);
  });
});
