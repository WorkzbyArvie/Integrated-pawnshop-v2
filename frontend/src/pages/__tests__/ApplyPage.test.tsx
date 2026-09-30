import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ApplyPage from '../ApplyPage';

/**
 * The public application flow.
 *
 * The properties that matter are the ones a panel or a regulator would ask
 * about: an applicant with no account can reach it, a branch that cannot
 * lawfully transact is never offered, the money shown is priced by the server,
 * and nothing on the page claims to be a loan.
 *
 * jsdom caveats, from `docs/UI-DESIGN-SYSTEM.md`: Radix `Select` does not open
 * on `pointerDown` — it needs `keyDown` with `ArrowDown`. Radix `Tabs` need
 * `mouseDown`. Both silently find zero matches otherwise.
 */

const QUOTE = {
  pawnshopId: 'shop-1',
  pawnshopName: 'Cebuana Main',
  // Mirrors the response shape `PublicAppraisalService.quote` actually returns.
  // The staleness check compares against `itemCategory` and `weightGrams`, so a
  // fixture that omits them can never match and every "continue" stays
  // disabled — which is how a plausible-but-wrong fixture hides a real flow.
  itemCategory: 'SILVER_JEWELRY',
  weightGrams: 10,
  purityPercent: null,
  appraisedValue: 800,
  recommendedLoanAmount: 440,
  gramRate: 80,
  ltvRatio: 0.55,
  termDays: 30,
  maturityDate: new Date(Date.now() + 30 * 864e5).toISOString(),
  gracePeriodDays: 90,
  belowStatutoryMinimum: false,
  statutoryMinLtv: 0.4,
  rates: { monthlyInterestRate: 0.035, serviceFeeRate: 0.01 },
  risk: { score: 40, band: 'HIGH', factors: [], blocking: false },
};

const RESERVATION = {
  reference: 'RSV-ABCDE-1234',
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
  appraisedValue: 800,
  recommendedLoanAmount: 440,
  termDays: 30,
  kycStatus: 'PENDING',
};

/**
 * `vi.mock` is hoisted above every top-level binding, so its factory cannot
 * close over a `const` declared below it — the component under test imports
 * `apiClient` and the mock module throws `Cannot access before
 * initialization`. The stub has to be built inside `vi.hoisted`.
 *
 * The call log lives on `globalThis` for the same reason: the stub functions
 * run later, but they must not close over the harness's own variables.
 */
const OPEN_SHOP = {
  pawnshopId: 'shop-1',
  pawnshopName: 'Cebuana Main',
  address: 'Dasmarinas, Cavite',
  contactPhone: '0917 555 0100',
  latitude: 14.4,
  longitude: 120.9,
  canAcceptApplications: true,
  complianceNote: null,
  missingDocuments: [],
  branches: [
    { id: 3, name: 'Main', location: 'Dasmarinas' },
    { id: 4, name: 'Aliaga', location: 'Aliaga' },
  ],
};

/** A shop missing regulatory documents — the state every shop was actually in. */
const CLOSED_SHOP = {
  pawnshopId: 'shop-2',
  pawnshopName: 'Jaro Dasmariñas',
  address: 'Jaro, Cavite',
  contactPhone: '0917 555 0200',
  latitude: 14.5,
  longitude: 120.8,
  canAcceptApplications: false,
  complianceNote: 'This branch is not accepting online applications at the moment.',
  missingDocuments: ['DTI_SEC', 'MAYORS_PERMIT'],
  branches: [{ id: 7, name: 'Jaro', location: 'Jaro' }],
};

const { stub, log, branchFixture } = vi.hoisted(() => {
  const log: Array<{ method: string; path: string; body?: unknown }> = [];
  // Held outside the stub so a test can swap the branch list before rendering.
  const branchFixture = { current: [] as any[] };
  return {
    log,
    branchFixture,
    stub: {
      get: async (path: string) => {
        log.push({ method: 'GET', path });
        return path === '/public/pawn/branches' ? branchFixture.current : [];
      },
      post: async (path: string, body?: unknown) => {
        log.push({ method: 'POST', path, body });
        if (path === '/public/pawn/quote') {
          // Echo the requested item, the way the real endpoint does. Returning a
          // fixed fixture instead would make the page's staleness check
          // disagree with every request but the one the fixture was written for.
          const asked = (body ?? {}) as Record<string, unknown>;
          return {
            ...QUOTE,
            itemCategory: asked.itemCategory,
            weightGrams: asked.weight,
            purityPercent: asked.purityPercent ?? null,
          };
        }
        if (path === '/public/pawn/reservations') return RESERVATION;
        return null;
      },
      upload: async (path: string) => {
        log.push({ method: 'POST', path });
        return { url: 'https://cdn.test/upload.jpg' };
      },
    },
  };
});

vi.mock('../../lib/apiClient', () => ({ api: stub, default: stub }));

const posted = (path: string) => log.filter((call) => call.method === 'POST' && call.path === path);
const uploads = () => log.filter((call) => call.method === 'POST' && call.path.includes('uploads'));

/** Which branch the form is currently pointed at, read off the radio group. */
const shopChosen = () => {
  const chosen = screen
    .getAllByRole('radio')
    .find((input) => (input as HTMLInputElement).checked);
  return chosen ? (chosen as HTMLInputElement).value : '';
};

/**
 * Step back twice. Queried by exact name rather than `/back/i`, because the
 * quoted terms and the "Back" button both match a loose pattern.
 */
const stepBack = async (times: number) => {
  for (let i = 0; i < times; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    // Let the step change render before the next click.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy());
  }
};

/**
 * Render inside a Router. The wordmark is a `<Link to="/">` — the only route off
 * this page — so the component now needs routing context, and a bare render
 * would throw on every test rather than on the one that cares.
 */
const renderPage = () =>
  render(
    <MemoryRouter>
      <ApplyPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  log.length = 0;
  branchFixture.current = [OPEN_SHOP, CLOSED_SHOP];
});

afterEach(cleanup);

/**
 * Radix `Select` will not open from `pointerDown` in jsdom. `ArrowDown` on the
 * trigger is both the reliable path and what a keyboard user actually presses.
 */
const chooseOption = async (label: string, optionText: RegExp) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByText(optionText);
  fireEvent.click(option);
};

/**
 * Attach a photograph the way a browser does after the user picks a file.
 *
 * The visible control is a `<button>` that calls `.click()` on a hidden
 * `<input type="file">` to open the native picker. Neither the click nor the
 * picker exists in jsdom, and `.click()` alone never fires `change` even in a
 * real browser until a file is chosen — so the test fires the change directly on
 * the input, which is the event the component actually listens for.
 */
const attachPhoto = async (inputId: string) => {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  expect(input, `no file input with id "${inputId}"`).toBeTruthy();

  const before = uploads().length;
  fireEvent.change(input!, {
    target: {
      files: [new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' })],
    },
  });
  await waitFor(() => expect(uploads().length).toBeGreaterThan(before));
};

const walkToItemStep = async () => {
  renderPage();
  await screen.findByText('Cebuana Main');
  fireEvent.click(screen.getByLabelText('Cebuana Main'));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText(/describe your item/i);
};

/**
 * Fill in the item and wait for a current quote.
 *
 * Continue stays disabled until the debounced price matches the form, so a test
 * that types a weight and immediately clicks Continue is racing the component
 * rather than testing it.
 */
const priceItem = async (category: RegExp, weight = '10') => {
  await chooseOption('What are you pawning?', category);
  fireEvent.change(screen.getByLabelText(/approximate weight/i), { target: { value: weight } });
  await waitFor(() =>
    expect((screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
};

const walkToIdentityStep = async (category: RegExp, weight = '10') => {
  await walkToItemStep();
  await priceItem(category, weight);
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText(/add a photograph/i);
  await attachPhoto('item-photo-1');
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText(/about you/i);
};

const fillIdentity = async () => {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Juan Dela Cruz' } });
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } });
  fireEvent.change(screen.getByLabelText('Collection address'), {
    target: { value: '1 Mabini St, Imus' },
  });
  await chooseOption('ID type', /Philippine ID/);
  fireEvent.change(screen.getByLabelText('ID number'), { target: { value: '1234-5678' } });
  await attachPhoto('id-front');
};

describe('ApplyPage — reachability', () => {
  it('renders above the session gate, so an applicant with no account gets it', () => {    // The route is wired before the `!session` branch in App.tsx. A regression
    // there strands every applicant on the marketing page, and it is invisible
    // to anyone testing with a staff account already open.
    // Read from the project root rather than `import.meta.url`: under this
    // vitest setup `import.meta.url` is not a `file:` URL and `readFileSync`
    // throws "The URL must be of scheme file".
    const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const applyReturn = source.indexOf('if (isApplyRoute) return <ApplyPage />;');
    // Anchored on the landing page rather than on `if (!session)`: App.tsx has
    // several session checks, and the one that matters is the branch that
    // renders the marketing page for a signed-out visitor.
    const loggedOutFallback = source.indexOf('return <LandingPage />;');

    expect(applyReturn).toBeGreaterThan(-1);
    expect(loggedOutFallback).toBeGreaterThan(-1);
    expect(applyReturn).toBeLessThan(loggedOutFallback);
  });
});

describe('ApplyPage — leaving the flow', () => {
  /**
   * The only way off this page.
   *
   * Step-level Back is not a substitute for this. It does not exist on step one
   * — that was the previous fix — and the footer unmounts entirely on the result
   * screen, so the last screen of the flow has no footer control at all.
   */
  it('links the wordmark back to the landing page', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    const home = screen.getByRole('link', { name: /pawngold home/i });
    expect(home.getAttribute('href')).toBe('/');
  });

  it('offers that route on the first step, where Back does not exist', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    // Both facts together: the page is a dead end without the wordmark.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('link', { name: /pawngold home/i })).toBeTruthy();
  });

  it('still offers it on the result screen, where the footer is gone', async () => {
    await walkToIdentityStep(/Silver jewellery/);
    await fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }));
    await screen.findByText('RSV-ABCDE-1234');

    // The footer's `step < 4` guard unmounts every footer control here, so the
    // wordmark is the only exit the applicant has.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('link', { name: /pawngold home/i })).toBeTruthy();
  });

  it('keeps the wordmark looking like a wordmark, not a button', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    // Asserted on the rendered span rather than the source: the link replaced a
    // `<p>`, and the point is that the *visible* treatment is unchanged. A
    // source regex here had to span the whole explanatory comment, which makes
    // it a test of how long a comment is.
    const wordmark = screen.getByRole('link', { name: /pawngold home/i });
    const label = wordmark.querySelector('span')!;
    const classes = label.className;

    // The micro-label contract: mono, uppercase, tracked, muted. No button
    // affordance — no rounded pill, no border, no fill.
    expect(classes).toContain('font-mono');
    expect(classes).toContain('uppercase');
    expect(classes).toContain('tracking-widest');
    expect(classes).toContain('text-muted');
    expect(classes).not.toMatch(/rounded|border|shadow/);
  });
});

describe('ApplyPage — layout', () => {
  /**
   * jsdom performs no layout, so an overlap between a sticky footer and the
   * last row of a long list cannot be observed from the DOM — the elements are
   * siblings and both "exist". It was found in a screenshot instead, with the
   * thirteenth branch cut in half behind the footer.
   *
   * So this reads the source. A behavioural test here would pass against the
   * broken layout, which is the same trap as asserting a `disabled` attribute
   * proves nothing about the control being unusable.
   */
  it('reserves room below the content for the pinned footer', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/ApplyPage.tsx'), 'utf8');

    // Bottom padding on the scroll container, matching roughly the footer's
    // height plus breathing space.
    //
    // Matched inside the container's own className rather than anywhere in the
    // file, and requiring a *space* before the class.
    //
    // Three looser forms each passed while the padding was deleted, and each
    // for its own reason worth recording:
    //   - a bare `/pb-2\d/` matches the `sm:pb-28` variant;
    //   - `\bpb-2\d` still matches it, because `:` is a non-word character so
    //     the word boundary sits happily between `sm:` and `pb-28`;
    //   - a loose `className="[^"]*pb-2\d[^"]*"` matches some other element's
    //     class on the same screen.
    // A source assertion has to be the thing that fails when the fix is
    // reverted, or it is decoration.
    expect(source).toMatch(
      /className="mx-auto w-full max-w-3xl[^"]* pb-2[048][^"]*"/,
    );

    // And the footer is genuinely pinned rather than in normal flow.
    expect(source).toMatch(/className="sticky bottom-0[^"]*"/);
  });

  it('keeps the branch list scrollable rather than trapping it behind the footer', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/ApplyPage.tsx'), 'utf8');

    // The page must not lock its own scroll height; if it did, the padding
    // above would be pointless and the footer would still overlap on a short
    // viewport.
    expect(source).not.toMatch(/overflow-hidden[^"]*min-h-screen/);
  });
});

describe('ApplyPage — branch selection', () => {
  it('renders every branch the server returns, open and closed alike', async () => {
    renderPage();

    expect(await screen.findByText('Cebuana Main')).toBeTruthy();
    expect(screen.getByText('Jaro Dasmariñas')).toBeTruthy();
    // The compliance judgement is server-side. The page renders what it is
    // given and invents no branch of its own.
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('does not claim the application is a loan', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    // A pawn loan requires physical possession of the collateral. Promising a
    // loan here would be promising something the system cannot deliver.
    expect(screen.getByText(/no loan is created here/i)).toBeTruthy();
  });

  it('will not advance without a branch', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    expect((screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('offers no Back control on the first step, rather than a dead one', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    // This was rendered disabled, and it was reported as a button that does
    // nothing. A greyed control with the shape of a button reads as broken, not
    // as "there is nothing before this step".
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('goes back a step once there is somewhere to go back to', async () => {
    await walkToItemStep();

    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    // Back to the branch list, and the choice is still made.
    expect(await screen.findByText('Choose a branch')).toBeTruthy();
    expect(shopChosen()).toBe('shop-1');
  });

  it('cannot go back past the first step', async () => {
    await walkToItemStep();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Choose a branch');

    // Once there, Back is gone rather than inert.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('shows a closed branch with its reason, and refuses to let it be chosen', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    // Hidden entirely was tried first, and against the live database it made the
    // page empty — 13 shops, all missing documents. A pawner who wants to pawn
    // today is served by being told where they cannot, not by an empty screen.
    const closed = screen.getByLabelText(/Jaro Dasmariñas — not accepting/i) as HTMLInputElement;
    expect(closed.disabled).toBe(true);
    expect(screen.getByText(/not accepting online applications/i)).toBeTruthy();

    // And it must not stay unchosen once a click lands on the label. React
    // forwards a click on a `<label>` to its control, and jsdom's `disabled`
    // handling for a labelled control is not the browser's — so the click is
    // dispatched at the `<label>`, which is how a real user's click actually
    // reaches the input, and the state is checked afterwards rather than
    // trusting the assertion about the attribute.
    const label = closed.closest('label')!;
    fireEvent.click(label);
    expect(shopChosen()).not.toBe('shop-2');
  });

  it('marks an open branch as accepting', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    const open = screen.getByLabelText('Cebuana Main') as HTMLInputElement;
    expect(open.disabled).toBe(false);
    expect(screen.getByText('Accepting')).toBeTruthy();
  });

  it('says so plainly when no branch can accept at all', async () => {
    branchFixture.current = [CLOSED_SHOP];
    renderPage();

    // The one state that must never render as an empty list: an empty list is
    // indistinguishable from a loading failure, and against the live database
    // it was exactly what happened.
    expect(await screen.findByText(/no branch near you can accept pawns/i)).toBeTruthy();
    // Still shows where to call, which an empty screen cannot.
    expect(screen.getByText('0917 555 0200')).toBeTruthy();
  });

  it('never renders a loading message once the list has arrived', async () => {
    renderPage();
    await screen.findByText('Cebuana Main');

    // "Loading branches…" on a screen that has branches is a stuck state, and
    // it is what a page that filtered everything out looked like.
    expect(screen.queryByText(/loading branches/i)).toBeNull();
  });
});

describe('ApplyPage — pricing', () => {
  it('will not let the applicant pass an unpriced item', async () => {
    await walkToItemStep();
    await chooseOption('What are you pawning?', /Silver jewellery/);
    fireEvent.change(screen.getByLabelText(/approximate weight/i), { target: { value: '10' } });

    // The quote is debounced, so there is a window where the form holds a
    // complete item and no current price for it. Advancing in that window used
    // to strand the applicant at the last step with nothing to submit.
    expect((screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await screen.findByText('₱440.00');
    expect((screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('re-prices when the weight changes, rather than keeping the old figure', async () => {
    await walkToItemStep();
    await priceItem(/Silver jewellery/);
    await screen.findByText('₱440.00');

    fireEvent.change(screen.getByLabelText(/approximate weight/i), { target: { value: '20' } });

    // The old price must not survive a change to the item it described.
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it('cannot be walked past with a figure that no longer matches the item', async () => {
    await walkToItemStep();
    await priceItem(/Silver jewellery/);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/add a photograph/i);
    await attachPhoto('item-photo-1');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/about you/i);

    // Go back to the item and change it. `submit` also guards on this, but the
    // point worth pinning is that the applicant cannot *reach* the last step
    // holding a price for a different item — a guard that only fires after the
    // fact is a guard the user has already been misled by.
    await stepBack(2);
    await screen.findByText(/describe your item/i);
    fireEvent.change(screen.getByLabelText(/approximate weight/i), { target: { value: '20' } });

    // The ₱440.00 on screen described a 10 g item. It stays visible, but the
    // gate closes until a price for 20 g replaces it — a stale figure is never
    // one the applicant can carry forward to the last step.
    expect((screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    screen.getByText('₱440.00');

    await waitFor(() =>
      expect((screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it('asks the server for the price rather than computing one', async () => {
    await walkToItemStep();
    await priceItem(/Silver jewellery/);

    await waitFor(() => expect(posted('/public/pawn/quote').length).toBeGreaterThan(0));
    expect(posted('/public/pawn/quote')[0].body).toMatchObject({
      weight: 10,
      itemCategory: 'SILVER_JEWELRY',
    });
  });

  it('shows the valuation and the loan as two named, unequal figures', async () => {
    await walkToItemStep();
    await priceItem(/Silver jewellery/);

    await screen.findByText('₱440.00');
    // Design rule 2: two equal-weight figures render the same number twice when
    // they coincide, and the reader cannot tell the loan from the value.
    expect(screen.getByText('₱800.00')).toBeTruthy();
    expect(screen.getByText(/55% of the ₱800\.00 appraised value/i)).toBeTruthy();
  });

  it('offers only the four real categories, so a typo cannot reach the pricer', async () => {
    await walkToItemStep();

    fireEvent.keyDown(screen.getByLabelText('What are you pawning?'), { key: 'ArrowDown' });

    for (const label of ['Gold jewellery', 'Gold coins', 'Silver jewellery', 'Diamonds']) {
      expect(await screen.findByText(new RegExp(label, 'i'))).toBeTruthy();
    }
    // `collateralClassFor` falls back to DIAMOND_JEWELRY for an unrecognised
    // name and diamonds carry the highest per-gram rate of the four — free text
    // here would quote a diamond price for a gold ring.
    expect(screen.queryByText(/platinum|unknown|custom/i)).toBeNull();
  });

  it('swaps the purity grades when the item is silver', async () => {
    await walkToItemStep();

    await chooseOption('What are you pawning?', /Gold jewellery/);
    fireEvent.keyDown(screen.getByLabelText('Purity'), { key: 'ArrowDown' });
    expect(await screen.findByText('18K — 75%')).toBeTruthy();

    await chooseOption('What are you pawning?', /Silver jewellery/);
    fireEvent.keyDown(screen.getByLabelText('Purity'), { key: 'ArrowDown' });
    // 24K is meaningless for sterling, and offering it invites a wrong figure.
    expect(await screen.findByText('Sterling — 92.5%')).toBeTruthy();
    expect(screen.queryByText('24K / pure — 99.9%')).toBeNull();
  });
});

describe('ApplyPage — evidence', () => {
  it('will not advance past photos with none attached', async () => {
    await walkToItemStep();
    await priceItem(/Silver jewellery/);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/add a photograph/i);

    expect((screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('never tells the applicant their identity is verified', async () => {
    await walkToIdentityStep(/Gold jewellery/);

    // Submitting a photograph of an ID is not verification of the person in it.
    // A reviewer adjudicates, and the page has to say so.
    expect(screen.getByText(/nothing here is marked verified automatically/i)).toBeTruthy();
    expect(screen.queryByText(/identity verified|verification complete/i)).toBeNull();
  });
});

describe('ApplyPage — submission', () => {
  it('names every gap instead of failing silently', async () => {
    await walkToIdentityStep(/Gold jewellery/);
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }));

    // Rule 8: a disabled control with no stated reason reads as broken. Each
    // field says what is missing, and nothing is sent.
    await screen.findByText(/enter your full name as it appears on your id/i);
    expect(screen.getByText(/enter a mobile number we can reach you on/i)).toBeTruthy();
    expect(posted('/public/pawn/reservations')).toHaveLength(0);
  });

  it('records a reference and a held window on success', async () => {
    await walkToIdentityStep(/Silver jewellery/);
    await fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }));

    expect(await screen.findByText('RSV-ABCDE-1234')).toBeTruthy();
    expect(screen.getByText(/this rate is held until/i)).toBeTruthy();
    // The next step has to be the visit, not a signature pad — a contract
    // requires the item in the shop.
    expect(screen.getByText(/confirm or revise the figure/i)).toBeTruthy();
  });

  it('sends the identity documents it collected', async () => {
    await walkToIdentityStep(/Silver jewellery/);
    await fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }));

    await screen.findByText('RSV-ABCDE-1234');
    const body = posted('/public/pawn/reservations')[0].body as Record<string, unknown>;
    expect(body.idType).toBe('NATIONAL_ID');
    expect(body.idNumber).toBe('1234-5678');
    expect(body.idFrontUrl).toBe('https://cdn.test/upload.jpg');
  });

  it('sends no identity document to the server on the item step', async () => {
    await walkToIdentityStep(/Silver jewellery/);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Juan Dela Cruz' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } });
    fireEvent.change(screen.getByLabelText('Collection address'), {
      target: { value: '1 Mabini St, Imus' },
    });
    await chooseOption('ID type', /Philippine ID/);
    fireEvent.change(screen.getByLabelText('ID number'), { target: { value: '1234-5678' } });
    fireEvent.click(screen.getByRole('button', { name: /submit application/i }));

    // Gating is client-side convenience only; the server is what must refuse.
    // Asserting the server's guarantee belongs in the backend spec, so here the
    // point is only that a partially-filled form is never posted.
    await screen.findByText(/a photograph of the front of your id is required/i);
    expect(posted('/public/pawn/reservations')).toHaveLength(0);
  });
});
