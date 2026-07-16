import { calculatePawnCharges } from './pawn-charge-calculator';

describe('calculatePawnCharges', () => {
  it('uses cent-based math for interest and service fees', () => {
    const result = calculatePawnCharges({
      principal: 1234.56,
      monthlyInterestRatePercent: 3,
      serviceFee: 50,
    });

    expect(result.principal).toBe(1234.56);
    expect(result.interest).toBe(37.04);
    expect(result.serviceFee).toBe(50);
    expect(result.latePenalty).toBe(0);
    expect(result.totalDue).toBe(1321.6);
  });

  it('applies a flat late penalty after the grace period', () => {
    const result = calculatePawnCharges({
      principal: 1000,
      monthlyInterestRatePercent: 3,
      serviceFee: 50,
      graceDays: 5,
      daysLate: 7,
      latePenaltyFlatAmount: 25,
    });

    expect(result.latePenalty).toBe(25);
    expect(result.totalDue).toBe(1105);
  });

  it('supports proportional late penalties when a flat amount is not set', () => {
    const result = calculatePawnCharges({
      principal: 2000,
      monthlyInterestRatePercent: 3,
      serviceFee: 50,
      graceDays: 0,
      daysLate: 15,
      latePenaltyRatePercent: 2,
    });

    expect(result.latePenalty).toBe(20);
    expect(result.totalDue).toBe(2130);
  });
});