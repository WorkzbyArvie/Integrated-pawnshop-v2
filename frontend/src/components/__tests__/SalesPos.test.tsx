import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SalesPos } from '../SalesPos';

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

vi.mock('../../App', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe('SalesPos', () => {
  it('renders appraisal deadline and auction flag inputs', () => {
    const { container, getByText } = render(
      <SalesPos branchId="pawnshop-1" setActiveTab={vi.fn()} />
    );

    expect(getByText('Appraisal Deadline')).toBeInTheDocument();
    expect(container.querySelector('input[type="date"]')).toBeTruthy();
    expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
  });
});
