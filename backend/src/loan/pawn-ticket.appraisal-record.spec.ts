import { PawnTicketService } from './pawn-ticket.service';

/**
 * `submitForApproval` recorded the loan in both `appraisedValue` and
 * `recommendedLoanAmount`. The loan is a fraction of the valuation, so every
 * approval record carried one figure twice and the collateral had no recorded
 * value at all — which is why the review dialog showed "₱440.00" twice with no
 * way to tell which was which.
 *
 * The same function wrote `riskScore: ticket.isHighRisk ? 60 : 0` — a score
 * invented from a boolean. The appraiser's real score was consumed at intake to
 * derive that boolean and then discarded, so the queue showed "60 HIGH" for any
 * flagged item regardless of how risky it actually was.
 */
const build = (ticket: Record<string, unknown>) => {
  const approvalCreate = jest.fn().mockResolvedValue({ id: 1 });
  const proofCreate = jest.fn().mockResolvedValue({ id: 1 });

  const service = Object.create(PawnTicketService.prototype) as PawnTicketService;
  (service as any).prisma = {
    ticket: {
      findUnique: jest.fn().mockResolvedValue({
        id: 7,
        ticketNumber: 'TKT-1790738306',
        lifecycleStatus: 'RECEIVED',
        loanAmount: 440,
        isHighRisk: true,
        pawnshopId: 'shop-1',
        ...ticket,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    approvalRecord: { create: approvalCreate },
  };
  (service as any).legalProofService = { createProof: proofCreate };
  (service as any).stateMachine = { transition: jest.fn().mockResolvedValue(undefined) };
  (service as any).receiptService = { generateReceipt: jest.fn().mockResolvedValue({}) };
  (service as any).logger = { warn: jest.fn(), error: jest.fn() };
  (service as any).assertPawnshopId = (t: { pawnshopId: string }) => t.pawnshopId;

  return { service, approvalCreate };
};

const payloadOf = (approvalCreate: jest.Mock) =>
  approvalCreate.mock.calls[0][0].data.payload;

describe('submitForApproval records the valuation and the real score', () => {
  it('records the valuation, not the loan, as appraisedValue', async () => {
    const { service, approvalCreate } = build({ appraisedValue: 800, riskScore: 60 });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    expect(payloadOf(approvalCreate).appraisedValue).toBe(800);
  });

  it('records the loan as the recommended amount, distinct from the valuation', async () => {
    const { service, approvalCreate } = build({ appraisedValue: 800, riskScore: 60 });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    const payload = payloadOf(approvalCreate);
    expect(payload.recommendedLoanAmount).toBe(440);
    // The defect: these were both the loan, so the reviewer saw one number twice.
    expect(payload.appraisedValue).not.toBe(payload.recommendedLoanAmount);
  });

  it('never writes the loan into both fields', async () => {
    // The invariant, rather than the expected number: splitting a loan into two
    // must not change the valuation, and vice versa.
    const { service, approvalCreate } = build({ appraisedValue: 2000, riskScore: 10 });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    const payload = payloadOf(approvalCreate);
    expect(payload.appraisedValue).not.toBe(payload.recommendedLoanAmount);
    expect(payload.recommendedLoanAmount).toBe(440);
  });

  it('records `amount` as the valuation, matching the appraisal flow', async () => {
    // `approval.service.ts` reads `record.amount` as `appraisedValue`, so this
    // has to be the valuation or the queue shows the loan under that label.
    const { service, approvalCreate } = build({ appraisedValue: 800, riskScore: 60 });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    expect(approvalCreate.mock.calls[0][0].data.amount).toBe(800);
  });

  it('records the risk score the appraiser actually produced', async () => {
    const { service, approvalCreate } = build({ appraisedValue: 800, riskScore: 17 });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    expect(payloadOf(approvalCreate).riskScore).toBe(17);
  });

  it('preserves a score of zero', async () => {
    // Zero is the score of a fully-cleared item, not an absence. `?? 0` or a
    // truthiness check would be indistinguishable from "not assessed".
    const { service, approvalCreate } = build({ appraisedValue: 800, riskScore: 0 });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    expect(payloadOf(approvalCreate).riskScore).toBe(0);
  });

  it('records null when nobody scored it, rather than inventing a number', async () => {
    const { service, approvalCreate } = build({
      appraisedValue: 800,
      riskScore: null,
      isHighRisk: true,
    });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    // This used to be `isHighRisk ? 60 : 0`, which put a fabricated 60 in front
    // of a reviewer for every flagged item.
    expect(payloadOf(approvalCreate).riskScore).toBeNull();
  });

  it('does not derive a score from the high-risk flag', async () => {
    const { service, approvalCreate } = build({
      appraisedValue: 800,
      riskScore: null,
      isHighRisk: true,
    });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    expect(payloadOf(approvalCreate).riskScore).not.toBe(60);
    expect(payloadOf(approvalCreate).riskScore).not.toBe(0);
  });

  it('falls back to the loan when the ticket predates the valuation column', async () => {
    // Nothing better is known for an old ticket, and the alternative is a blank.
    const { service, approvalCreate } = build({ appraisedValue: null, riskScore: null });

    await service.submitForApproval(7, 'user-1', 'MANAGER');

    expect(payloadOf(approvalCreate).appraisedValue).toBe(440);
  });

  it('still submits for a ticket that is not RECEIVED', async () => {
    // Guards against the valuation change quietly widening the guard.
    const { service } = build({ appraisedValue: 800, lifecycleStatus: 'ACTIVE' });

    await expect(service.submitForApproval(7, 'user-1', 'MANAGER')).rejects.toThrow(
      /Must be RECEIVED/i,
    );
  });
});
