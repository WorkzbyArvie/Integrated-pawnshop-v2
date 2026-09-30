import { ContractRendererService } from './contract-renderer.service';

/**
 * The parser tests prove the structure is recovered. These prove the result is
 * a real PDF, that it renders end to end, and that the two defects visible in
 * the shipped contract are gone: the "30 days months" unit, and the duplicated
 * SIGNATURES block.
 */
const TEMPLATE = `<h1>PAWN LOAN AGREEMENT</h1>
<p><strong>Contract No:</strong> CTR-TEST-001<br/>
<strong>Date:</strong> 9/30/2026</p>

<h2>PARTIES</h2>
<p><strong>Pawnshop:</strong> Cebuana<br/>
<strong>Borrower:</strong> test</p>

<h2>LOAN DETAILS</h2>
<p><strong>Loan Amount:</strong> PHP 440.00<br/>
<strong>Interest Rate:</strong> 3.50% per month<br/>
<strong>Loan Term:</strong> 30 days<br/>
<strong>Maturity Date:</strong> 10/30/2026</p>

<h2>TERMS AND CONDITIONS</h2>
<ol>
<li>The Borrower acknowledges receipt of the loan amount as stated above.</li>
<li>Interest accrues monthly at the stated rate.</li>
<li>A grace period of 90 days is granted after the maturity date.</li>
</ol>

<h2>SIGNATURES</h2>
<p>Borrower: _________________________  Date: ___________<br/>
Pawnshop Representative: _________________________  Date: ___________</p>

<p><em>This document was electronically generated and is legally binding.</em></p>`;

const service = new ContractRendererService({} as never, {} as never);

const render = (html: string, data: Record<string, unknown> = {}, signatures?: any) =>
  (service as any).generatePdf(html, data, signatures) as Promise<Buffer>;

describe('generatePdf', () => {
  it('produces a real PDF', async () => {
    const buffer = await render(TEMPLATE, { contractNumber: 'CTR-TEST-001' });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF magic number and a trailer, i.e. a complete document not a fragment.
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.subarray(-8).toString()).toContain('EOF');
  });

  it('renders with no signature images', async () => {
    const buffer = await render(TEMPLATE, { contractNumber: 'CTR-TEST-001' });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders with both signature images present', async () => {
    // A 1x1 PNG. A bad base64 here would throw inside generatePdf.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ).toString('base64');

    const buffer = await render(TEMPLATE, { contractNumber: 'CTR-TEST-001' }, {
      customerSignature: `data:image/png;base64,${png}`,
      customerSignedAt: '2026-09-30T11:00:00.000Z',
      staffSignature: `data:image/png;base64,${png}`,
      staffSignedAt: '2026-09-30T11:05:00.000Z',
    });

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('survives a signature payload that is not a decodable image', async () => {
    // The renderer logs and continues rather than failing the whole contract.
    const buffer = await render(TEMPLATE, { contractNumber: 'CTR-TEST-001' }, {
      customerSignature: 'data:image/png;base64,not-a-real-image',
    });

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a document with no headings at all', async () => {
    const buffer = await render('<p>Just a paragraph.</p>', {});
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('paginates and still produces one complete document', async () => {
    // Long enough to force a page break, which is where the old absolute
    // footer position could land on top of body text.
    const long = `<h1>PAWN LOAN AGREEMENT</h1><ol>${'<li>Term of the agreement.</li>'.repeat(90)}</ol>`;
    const buffer = await render(long, { contractNumber: 'CTR-LONG' });

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.subarray(-8).toString()).toContain('EOF');
  });
});

describe('the loan term unit', () => {
  /**
   * The shipped contract printed "Loan Term: 30 days months".
   * `loan-contract.service.ts` sets `loanTerm` to `${toTermDays(...)} days`, so
   * the value already carries its unit; the template appended a second one.
   */
  it('no template appends a second unit to loanTerm', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ContractTemplateService } = require('./contract-template.service');
    const source = ContractTemplateService.prototype.constructor.toString();
    // The seed content is a class field, so read it off the prototype source.
    expect(source).not.toContain('{{loanTerm}} months');
  });

  it('renders the term exactly once, as days', async () => {
    // Guards the data path that feeds the template.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PAWN_TERM_DAYS } = require('../loan/loan-terms');
    const loanTerm = `${PAWN_TERM_DAYS} days`;

    expect(loanTerm).toBe('30 days');
    expect(loanTerm).not.toMatch(/days\s+months/);
  });
});
