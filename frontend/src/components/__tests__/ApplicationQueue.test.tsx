import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

import ApplicationQueue from '../ApplicationQueue';

/**
 * Where an online application becomes a real pawn.
 *
 * The public flow was write-only before this screen existed: applicants filled
 * in a form and the branch had nowhere to see it. The properties worth pinning
 * are the ones a panel would probe:
 *
 *   - a failure is never rendered as an empty queue ("no applications yet" is a
 *     lie when the request 500'd);
 *   - the online figure is never presented as agreed;
 *   - a revision has to be explained, because the applicant was told a different
 *     number and will sign a contract for this one.
 */
const PENDING = {
  reference: 'RSV-ABCDE-1234',
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 4 * 3600e3).toISOString(),
  customerName: 'Juan Dela Cruz',
  contactNumber: '09171234567',
  address: '1 Mabini St, Imus',
  itemCategory: 'GOLD_JEWELRY',
  itemDescription: '22K necklace',
  weightGrams: 5.5,
  purityPercent: 75,
  photoUrls: [],
  appraisedValue: 17325,
  recommendedLoanAmount: 12127.5,
  termDays: 30,
  kycStatus: 'PENDING',
  rejectionReason: null,
};

const { stub, log, fixture } = vi.hoisted(() => {
  const log: Array<{ method: string; path: string; body?: unknown }> = [];
  const fixture = { rows: [] as any[], fail: false };
  return {
    log,
    fixture,
    stub: {
      get: async (path: string) => {
        log.push({ method: 'GET', path });
        if (fixture.fail) throw new Error('Gateway timeout');
        return fixture.rows;
      },
      post: async (path: string, body?: unknown) => {
        log.push({ method: 'POST', path, body });
        return { ticket: { id: 77, ticketNumber: 'TKT-1' }, revision: null };
      },
    },
  };
});

vi.mock('../../lib/apiClient', () => ({ api: stub, default: stub }));

const posted = (fragment: string) =>
  log.filter((c) => c.method === 'POST' && c.path.includes(fragment));

beforeEach(() => {
  log.length = 0;
  fixture.rows = [PENDING];
  fixture.fail = false;
});

afterEach(cleanup);

const openDialog = async () => {
  render(<ApplicationQueue />);
  await screen.findByText('RSV-ABCDE-1234');
  fireEvent.click(screen.getByRole('button', { name: /inspect and convert/i }));
  await screen.findByRole('dialog');
};

describe('ApplicationQueue — the list', () => {
  it('shows a received application and its estimate', async () => {
    render(<ApplicationQueue />);

    expect(await screen.findByText('Juan Dela Cruz')).toBeTruthy();
    expect(screen.getByText('₱12,127.50')).toBeTruthy();
  });

  it('reads the tenant from the session, not a query string', async () => {
    render(<ApplicationQueue />);
    await screen.findByText('Juan Dela Cruz');

    // The route derives the tenant from `req.user`. A param here could only
    // narrow it for SUPER_ADMIN, so sending one would be a signal that the
    // client is reaching outside its own shop.
    expect(log[0].path).toBe('/public/pawn/reservations');
  });

  it('never calls the online figure an offer', async () => {
    await openDialog();

    // The number came from a self-reported weight. Presenting it as agreed would
    // be the first of the two figures on a contract the pawner never agreed to,
    // and the dialog is where the appraiser is about to confirm or revise it.
    expect(screen.getByText('An estimate from a self-reported weight. Not an offer.')).toBeTruthy();
  });

  it('says the identity documents have not been reviewed', async () => {
    render(<ApplicationQueue />);
    await screen.findByText('Juan Dela Cruz');

    // A reviewer judged these at the counter, not the applicant. PENDING is
    // what makes that honest, so the screen must not imply otherwise.
    expect(screen.getByText('Not yet reviewed')).toBeTruthy();
  });

  it('shows a failed load as a failure, not as an empty queue', async () => {
    fixture.fail = true;
    render(<ApplicationQueue />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    // "No applications yet" after a 500 is a lie the operator would act on.
    expect(screen.queryByText(/no applications yet/i)).toBeNull();
  });

  it('says so plainly when the queue really is empty', async () => {
    fixture.rows = [];
    render(<ApplicationQueue />);

    expect(await screen.findByText(/no applications yet/i)).toBeTruthy();
  });
});

describe('ApplicationQueue — converting', () => {
  it('seeds the dialog from the online estimate for the appraiser to correct', async () => {
    await openDialog();

    const weight = screen.getByLabelText(/weighed \(g\)/i) as HTMLInputElement;
    expect(weight.value).toBe('5.5');
  });

  it('sends the appraiser’s own figures, not the online ones', async () => {
    await openDialog();

    fireEvent.change(screen.getByLabelText(/weighed \(g\)/i), { target: { value: '5.4' } });
    fireEvent.change(screen.getByLabelText(/appraised value/i), { target: { value: '17000' } });
    fireEvent.change(screen.getByLabelText(/loan approved/i), { target: { value: '11900' } });
    fireEvent.change(screen.getByLabelText(/why it changed/i), {
      target: { value: 'Hallmark reads 18K' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create pawn ticket/i }));

    await waitFor(() => expect(posted('/convert')).toHaveLength(1));
    const body = posted('/convert')[0].body as Record<string, unknown>;

    expect(body).toMatchObject({ weight: 5.4, appraisedValue: 17000, loanAmount: 11900 });
    expect(body.revisionReason).toBe('Hallmark reads 18K');
  });

  it('demands a reason when the figures differ from the quote', async () => {
    await openDialog();

    fireEvent.change(screen.getByLabelText(/loan approved/i), { target: { value: '11900' } });

    // The applicant was told 12,127.50. A contract for 11,900 needs the gap
    // explained, and the server refuses without it.
    expect(screen.getByText(/these figures differ from the online estimate/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create pawn ticket/i }));

    expect(await screen.findByText(/record why/i)).toBeTruthy();
    expect(posted('/convert')).toHaveLength(0);
  });

  it('shows no revision prompt while the figures still agree', async () => {
    await openDialog();

    expect(screen.queryByText(/these figures differ/i)).toBeNull();
  });

  it('converts without a reason when the appraisal confirms the estimate', async () => {
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: /create pawn ticket/i }));

    await waitFor(() => expect(posted('/convert')).toHaveLength(1));
    const body = posted('/convert')[0].body as Record<string, unknown>;
    expect(body.revisionReason).toBeUndefined();
  });

  it('refuses an empty weight rather than sending a zero', async () => {
    await openDialog();

    fireEvent.change(screen.getByLabelText(/weighed \(g\)/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /create pawn ticket/i }));

    expect(await screen.findByText(/enter the weight you measured/i)).toBeTruthy();
    expect(posted('/convert')).toHaveLength(0);
  });

  it('surfaces a server refusal instead of closing the dialog', async () => {
    stub.post = async (path: string) => {
      log.push({ method: 'POST', path });
      throw new Error('4 of the required regulatory documents are not on file');
    };

    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /create pawn ticket/i }));

    // A refusal here means the pawner is standing at the counter. Closing the
    // dialog would look like it worked.
    expect(
      await screen.findByText(/regulatory documents are not on file/i),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps the action reachable without scrolling the dialog', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/ApplicationQueue.tsx'),
      'utf8',
    );

    // Rule 3. The appraiser is at the counter with the item in hand; an action
    // below the fold reads as a missing one. The dialog is a fixed-height flex
    // column with a scrolling body and a `shrink-0` footer.
    expect(source).toMatch(/max-h-\[90vh\]/);
    expect(source).toMatch(/overflow-y-auto/);
    expect(source).toMatch(/shrink-0/);
  });

  it('widens the dialog at its breakpoint', () => {
    const source = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/ApplicationQueue.tsx'),
      'utf8',
    );

    // Rule 9. `DialogContent` ships `sm:max-w-lg`; a bare `max-w-2xl` loses to
    // it on equal specificity and the dialog silently stays 512px, clipping
    // three number fields.
    expect(source).toMatch(/sm:max-w-2xl/);
    expect(source).not.toMatch(/DialogContent className="max-w-/);
  });
});
