import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import KycStatusBadge from '../KycStatusBadge';

describe('KycStatusBadge', () => {
  it('renders the VERIFIED state with its palette classes and icon', () => {
    render(<KycStatusBadge status="VERIFIED" />);

    const badge = screen.getByTestId('kyc-status-badge');
    expect(badge).toHaveClass('bg-emerald-500/10');
    expect(badge).toHaveClass('text-emerald-400');
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByTestId('kyc-icon-verified')).toBeInTheDocument();
    expect(screen.getByLabelText('KYC status: Verified')).toBeInTheDocument();
  });

  it('renders the PENDING state with gold palette classes and icon', () => {
    render(<KycStatusBadge status="PENDING" />);

    const badge = screen.getByTestId('kyc-status-badge');
    expect(badge).toHaveClass('bg-[rgba(201,160,92,0.1)]');
    expect(badge).toHaveClass('text-[#C9A05C]');
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByTestId('kyc-icon-pending')).toBeInTheDocument();
  });

  it('renders the REJECTED state with red palette classes and icon', () => {
    render(<KycStatusBadge status="REJECTED" />);

    const badge = screen.getByTestId('kyc-status-badge');
    expect(badge).toHaveClass('bg-red-500/10');
    expect(badge).toHaveClass('text-red-400');
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByTestId('kyc-icon-rejected')).toBeInTheDocument();
  });

  it('renders the NOT_SUBMITTED default pill for null status', () => {
    render(<KycStatusBadge status={null} />);

    const badge = screen.getByTestId('kyc-status-badge');
    expect(badge).toHaveClass('bg-[#1C1C26]');
    expect(badge).toHaveClass('text-[#6B655C]');
    expect(screen.getByText('Not Submitted')).toBeInTheDocument();
    expect(screen.getByTestId('kyc-icon-not-submitted')).toBeInTheDocument();
  });

  it('renders the NOT_SUBMITTED default pill for undefined status', () => {
    render(<KycStatusBadge status={undefined} />);

    expect(screen.getByText('Not Submitted')).toBeInTheDocument();
    expect(screen.getByTestId('kyc-icon-not-submitted')).toBeInTheDocument();
  });

  it('renders the NOT_SUBMITTED default pill for unknown status values', () => {
    render(<KycStatusBadge status="UNKNOWN_STATE" />);

    expect(screen.getByText('Not Submitted')).toBeInTheDocument();
  });
});
