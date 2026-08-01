import { TICKET_LIFECYCLE } from './pawn-lifecycle';

describe('TICKET_LIFECYCLE transition table', () => {
  it('defines the PENDING_APPROVAL -> RECEIVED reject-to-reappraise return path for MANAGER/OWNER/ADMIN', () => {
    const transition = TICKET_LIFECYCLE.find(
      (t) => t.from === 'PENDING_APPROVAL' && t.to === 'RECEIVED',
    );
    expect(transition).toBeDefined();
    expect(transition!.allowedRoles).toEqual(['MANAGER', 'OWNER', 'ADMIN']);
  });

  it('allows ADMIN on PENDING_APPROVAL -> OFFER_MADE', () => {
    const transition = TICKET_LIFECYCLE.find(
      (t) => t.from === 'PENDING_APPROVAL' && t.to === 'OFFER_MADE',
    );
    expect(transition).toBeDefined();
    expect(transition!.allowedRoles).toContain('ADMIN');
  });

  it('allows ADMIN on ACTIVE -> REDEEMED', () => {
    const transition = TICKET_LIFECYCLE.find((t) => t.from === 'ACTIVE' && t.to === 'REDEEMED');
    expect(transition).toBeDefined();
    expect(transition!.allowedRoles).toContain('ADMIN');
  });

  it('allows ADMIN on GRACE_PERIOD -> REDEEMED', () => {
    const transition = TICKET_LIFECYCLE.find(
      (t) => t.from === 'GRACE_PERIOD' && t.to === 'REDEEMED',
    );
    expect(transition).toBeDefined();
    expect(transition!.allowedRoles).toContain('ADMIN');
  });

  it('has no duplicate from/to pairs in the table', () => {
    const keys = TICKET_LIFECYCLE.map((t) => `${t.from}->${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
