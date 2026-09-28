import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DecisionSupport } from '../DecisionSupportPanel';
import api from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  default: { get: vi.fn() },
}));

const mockedGet = vi.mocked(api.get);

/** A report with nothing to measure — the state a fresh shop is actually in. */
function emptyReport() {
  return {
    pawnshopId: 'shop-1',
    branchId: null,
    generatedAt: '2026-09-28T09:00:00.000Z',
    dataQuality: { servedTickets: 0, canPredictWait: false, warnings: ['0 completed tickets on record. Prediction needs 10 before it will produce a number.'] },
    waitPrediction: {
      minutes: { value: null, basis: 'insufficient_history', sampleSize: 0 },
      meanServiceMinutes: { value: null, basis: 'insufficient_history', sampleSize: 0 },
      peopleAhead: 0,
      activeCounters: 0,
      explanation: 'No waiting tickets.',
    },
    noShowRate: {
      overall: { value: null, basis: 'insufficient_history', sampleSize: 0 },
      byQueueType: [],
    },
    predictionCalibration: {
      biasMinutes: { value: null, basis: 'insufficient_history', sampleSize: 0 },
      comparedSamples: 0,
      note: 'Not enough history to check the estimate against outcomes yet.',
    },
    counterUtilisation: [],
    peakHours: [],
    serviceTimeByType: [
      { queueType: 'PAWNING', meanServiceMinutes: null, samples: 0 },
      { queueType: 'RENEWAL', meanServiceMinutes: null, samples: 0 },
    ],
    lifecycleExposure: [],
  };
}

/** A report with a real measured shop. */
function populatedReport() {
  const report = emptyReport();
  return {
    ...report,
    dataQuality: { servedTickets: 148, canPredictWait: true, warnings: [] },
    waitPrediction: {
      minutes: { value: 20, basis: 'observed' as const, sampleSize: 148 },
      meanServiceMinutes: { value: 10, basis: 'observed' as const, sampleSize: 148 },
      peopleAhead: 4,
      activeCounters: 2,
      explanation: '4 tickets ahead, about 10 min per customer across 2 counters, from 148 completed tickets.',
    },
    noShowRate: {
      overall: { value: 6.4, basis: 'observed' as const, sampleSize: 78 },
      byQueueType: [{ queueType: 'PAWNING', noShows: 5, notified: 78, rate: 6.4 }],
    },
    predictionCalibration: {
      biasMinutes: { value: 2.4, basis: 'observed' as const, sampleSize: 96 },
      comparedSamples: 96,
      note: 'The estimate tends to run long by this much.',
    },
    counterUtilisation: [{ counter: '1', served: 72, meanServiceMinutes: 9.4 }],
    peakHours: [{ hour: 9, joined: 31 }, { hour: 14, joined: 22 }],
    serviceTimeByType: [{ queueType: 'PAWNING', meanServiceMinutes: 10, samples: 96 }],
    lifecycleExposure: [{ lifecycleStatus: 'ACTIVE', tickets: 42, principal: 315000 }],
  };
}

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DecisionSupport panel', () => {
  it('says it has not enough data rather than showing a placeholder number', async () => {
    // The screen this replaces rendered `total * 0.035` and a hardcoded
    // '+12.5%'. When there is no history, the honest state has to be visible.
    mockedGet.mockResolvedValue(emptyReport());
    render(<DecisionSupport />);

    await waitFor(() =>
      expect(screen.getAllByText('Not enough data').length).toBeGreaterThan(0),
    );

    // The banner says so in its own words, and no zero or dash is standing in
    // for a measurement.
    expect(screen.getByText('Not enough history to predict yet')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('+12.5%')).not.toBeInTheDocument();
    // The panel is explicit about what it does not yet know.
    expect(screen.getByText(/Prediction needs 10 before it will produce a number/i)).toBeInTheDocument();
  });

  it('explains the basis of every measurement it does show', async () => {
    mockedGet.mockResolvedValue(populatedReport());
    render(<DecisionSupport />);

    await waitFor(() => expect(screen.getByText('6.4')).toBeInTheDocument());

    // Several cards measure the same way, so each states its basis.
    expect(
      screen.getAllByText(/measured from your own completed tickets/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/78 samples?/i)).toBeInTheDocument();
  });

  it('reports the estimate bias in plain language, not just a signed number', async () => {
    mockedGet.mockResolvedValue(populatedReport());
    render(<DecisionSupport />);

    await waitFor(() => expect(screen.getByText('+2.4')).toBeInTheDocument());
    expect(screen.getByText(/tends to run long/i)).toBeInTheDocument();
    expect(screen.getByText(/96 tickets compared/i)).toBeInTheDocument();
  });

  it('offers a readable table behind every chart so figures are checkable', async () => {
    mockedGet.mockResolvedValue(populatedReport());
    render(<DecisionSupport />);

    await waitFor(() =>
      expect(screen.getByText('Service time by transaction')).toBeInTheDocument(),
    );

    // Every chart can be flipped to the numbers behind it, which is what makes
    // a figure verifiable rather than a black box.
    const dataButtons = screen.getAllByRole('button', { name: /data/i });
    expect(dataButtons.length).toBe(4);

    fireEvent.click(dataButtons[0]);

    await waitFor(() => expect(screen.getByText('10.0 min')).toBeInTheDocument());
    // And it flips back.
    expect(screen.getByRole('button', { name: /chart/i })).toBeInTheDocument();
  });

  it('lists lifecycle exposure as raw counts and principal, with no rate applied', async () => {
    mockedGet.mockResolvedValue(populatedReport());
    render(<DecisionSupport />);

    await waitFor(() => expect(screen.getByText('Where the capital is')).toBeInTheDocument());

    const table = screen.getByRole('table', { name: /ticket counts and principal/i });
    const row = within(table).getByText('active').closest('tr')!;
    expect(within(row).getByText('42')).toBeInTheDocument();
    expect(within(row).getByText('₱315,000')).toBeInTheDocument();
  });

  it('surfaces a failure as an explicit alert rather than an empty panel', async () => {
    mockedGet.mockRejectedValue(new Error('boom'));
    render(<DecisionSupport />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/decision support unavailable/i),
    );
  });

  it('passes the selected branch to the API so figures are branch-scoped', async () => {
    mockedGet.mockResolvedValue(populatedReport());
    render(<DecisionSupport branchId={null} activeBranchId={7} />);

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/decision-support/report', { branchId: '7' }),
    );
  });
});
