import { PawnshopGuard } from './pawnshop.guard';

/**
 * `PawnshopGuard` vs the tenant middleware in front of it.
 *
 * `main.ts` exempts SUPER_ADMIN before it requires a `pawnshop-id` header. The
 * guard then required one anyway, which made the platform surface unusable for
 * the only role that operates it: `/tenant-governance` answered 400 "Missing
 * pawnshop-id header" and the Super Admin compliance tab rendered blank.
 *
 * The frontend never sends the header for that role, and cannot — `App.tsx`
 * clears `active_pawnshop_id` when the role is Super Admin, because a platform
 * operator belongs to no tenant.
 */
const build = () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  };
  return new PawnshopGuard(reflector as any);
};

const contextFor = (options: {
  path: string;
  headers?: Record<string, string>;
  method?: string;
  actor?: { role?: string; pawnshopId?: string | null };
  user?: { role?: string };
}) => ({
  switchToHttp: () => ({
    getRequest: () => ({
      path: options.path,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      actor: options.actor,
      user: options.user,
    }),
  }),
  getHandler: () => null,
  getClass: () => null,
}) as never;

const UUID = '70e162ef-507a-4c21-9668-58da521baf85';

describe('SUPER_ADMIN', () => {
  it('is not required to send a pawnshop-id', async () => {
    const guard = build();

    await expect(
      guard.canActivate(
        contextFor({
          path: '/tenant-governance/overview',
          actor: { role: 'SUPER_ADMIN', pawnshopId: null },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('is exempt whatever casing the role arrives in', async () => {
    const guard = build();

    // `/analytics/summary`, not `/compliance/*`: the compliance prefix is
    // already in EXEMPT_PREFIXES, so a path under it passes whether or not the
    // SUPER_ADMIN exemption exists, and the assertion would prove nothing.
    for (const role of ['SUPER_ADMIN', 'super_admin', 'Super Admin', 'super-admin']) {
      await expect(
        guard.canActivate(contextFor({ path: '/analytics/summary', actor: { role } })),
      ).resolves.toBe(true);
    }
  });

  it('is exempt when the role arrives on req.user instead of req.actor', async () => {
    const guard = build();

    await expect(
      guard.canActivate(
        contextFor({ path: '/tenant-governance/overview', user: { role: 'SUPER_ADMIN' } }),
      ),
    ).resolves.toBe(true);
  });

  it('still sends a tenant-scoped analytics read to the platform', async () => {
    const guard = build();

    // The exact failure that was reported: a Super Admin tab calling a route
    // outside the exempt prefixes and getting 400. `/analytics/summary` is not
    // exempt, so this only passes because of the SUPER_ADMIN branch.
    await expect(
      guard.canActivate(
        contextFor({ path: '/analytics/summary', actor: { role: 'SUPER_ADMIN' } }),
      ),
    ).resolves.toBe(true);
  });
});

describe('tenant-scoped roles are unaffected', () => {
  it('still requires the header for an owner', async () => {
    const guard = build();

    await expect(
      guard.canActivate(contextFor({ path: '/tenant-governance/overview', actor: { role: 'OWNER' } })),
    ).rejects.toThrow(/Missing pawnshop-id/i);
  });

  it('still requires the header for a manager', async () => {
    const guard = build();

    await expect(
      guard.canActivate(contextFor({ path: '/analytics/summary', actor: { role: 'MANAGER' } })),
    ).rejects.toThrow(/Missing pawnshop-id/i);
  });

  it('still rejects a malformed header', async () => {
    const guard = build();

    await expect(
      guard.canActivate(
        contextFor({
          path: '/analytics/summary',
          headers: { 'pawnshop-id': 'not-a-uuid' },
          actor: { role: 'OWNER' },
        }),
      ),
    ).rejects.toThrow(/valid UUID/i);
  });

  it('accepts a valid header for a tenant role', async () => {
    const guard = build();

    await expect(
      guard.canActivate(
        contextFor({
          path: '/analytics/summary',
          headers: { 'pawnshop-id': UUID },
          actor: { role: 'OWNER', pawnshopId: UUID },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('does not exempt a role merely containing the word admin', async () => {
    const guard = build();

    // `SUPER_ADMIN` must be matched whole. A loose `includes('ADMIN')` would
    // hand a tenant-less header to every administrative role on the platform.
    for (const role of ['SUPERADMIN', 'X_SUPER_ADMIN', 'ADMIN', 'SUPER_ADMIN_2']) {
      await expect(
        guard.canActivate(contextFor({ path: '/analytics/summary', actor: { role } })),
      ).rejects.toThrow(/Missing pawnshop-id/i);
    }
  });

  it('does not exempt a bidder', async () => {
    const guard = build();

    await expect(
      guard.canActivate(contextFor({ path: '/analytics/summary', actor: { role: 'BIDDER' } })),
    ).rejects.toThrow(/Missing pawnshop-id/i);
  });
});

describe('the pre-existing exemptions still hold', () => {
  it('still lets a public route through with no header', async () => {
    const guard = build();

    await expect(
      guard.canActivate(contextFor({ path: '/auth/login', headers: {} })),
    ).resolves.toBe(true);
  });

  it('still lets a preflight through', async () => {
    const guard = build();

    await expect(
      guard.canActivate(contextFor({ path: '/analytics/summary', method: 'OPTIONS' })),
    ).resolves.toBe(true);
  });

  it('still refuses a tenant route with no identity at all', async () => {
    const guard = build();

    // No actor and no user — the header requirement is the only thing left, and
    // dropping it for unidentified callers would open the whole surface.
    await expect(
      guard.canActivate(contextFor({ path: '/analytics/summary' })),
    ).rejects.toThrow(/Missing pawnshop-id/i);
  });
});