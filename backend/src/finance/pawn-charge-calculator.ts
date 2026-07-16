export interface PawnChargeInput {
  principal: number;
  monthlyInterestRatePercent: number;
  serviceFee?: number;
  daysLate?: number;
  graceDays?: number;
  latePenaltyRatePercent?: number;
  latePenaltyFlatAmount?: number;
}

export interface PawnChargeBreakdown {
  principal: number;
  interest: number;
  serviceFee: number;
  latePenalty: number;
  totalDue: number;
}

const toCents = (amount: number): number => Math.round((Number(amount) || 0) * 100);

const fromCents = (cents: number): number => Number((cents / 100).toFixed(2));

export function calculatePawnCharges(input: PawnChargeInput): PawnChargeBreakdown {
  const principalCents = toCents(input.principal);
  const serviceFeeCents = toCents(input.serviceFee ?? 50);
  const interestCents = Math.round(
    (principalCents * (Number(input.monthlyInterestRatePercent) || 0)) / 100,
  );

  const graceDays = Math.max(0, Math.floor(Number(input.graceDays) || 0));
  const daysLate = Math.max(0, Math.floor(Number(input.daysLate) || 0));
  const overdueDays = Math.max(0, daysLate - graceDays);

  let latePenaltyCents = 0;
  if (overdueDays > 0) {
    if (input.latePenaltyFlatAmount !== undefined) {
      latePenaltyCents = toCents(input.latePenaltyFlatAmount);
    } else {
      const latePenaltyRatePercent = Number(input.latePenaltyRatePercent) || 0;
      latePenaltyCents = Math.round(
        (principalCents * latePenaltyRatePercent * overdueDays) / 3000,
      );
    }
  }

  const totalDueCents = principalCents + interestCents + serviceFeeCents + latePenaltyCents;

  return {
    principal: fromCents(principalCents),
    interest: fromCents(interestCents),
    serviceFee: fromCents(serviceFeeCents),
    latePenalty: fromCents(latePenaltyCents),
    totalDue: fromCents(totalDueCents),
  };
}