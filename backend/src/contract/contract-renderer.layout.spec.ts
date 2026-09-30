import { ContractRendererService } from './contract-renderer.service';

/**
 * The old renderer flattened every tag to a newline:
 *
 *   html.replace(/<[^>]*>/g, '\n')
 *
 * The templates write `<strong>Label:</strong> value<br/>` specifically so a
 * label and its value sit on one row. That `<br/>` became a line break, so the
 * printed contract showed "Loan Amount:" on one line and "PHP 440.00" on the
 * next, for every field, down the whole page. These tests pin the structure the
 * flattener destroyed.
 */
const service = new ContractRendererService({} as never, {} as never);

const parse = (html: string) => (service as any).htmlToBlocks(html) as any[];
const strip = (html: string) => (service as any).stripSignatureBlock(html) as string;
const split = (lines: any[]) => (service as any).splitLabelValue(lines) as any[];

describe('htmlToBlocks', () => {
  it('keeps a label and its value on one line', () => {
    const blocks = parse(
      '<p><strong>Loan Amount:</strong> PHP {{loanAmount}}<br/>' +
      '<strong>Interest Rate:</strong> {{interestRate}}% per month</p>',
    );

    expect(blocks).toHaveLength(1);
    // Two rows, not four lines. This is the defect the whole rewrite exists for.
    expect(blocks[0].lines).toHaveLength(2);
    expect(blocks[0].lines[0][0].text).toBe('Loan Amount:');
  });

  it('marks a label run bold and its value not', () => {
    const [block] = parse('<p><strong>Loan Amount:</strong> PHP 440.00</p>');
    const [label, value] = block.lines[0];

    expect(label).toEqual({ text: 'Loan Amount:', bold: true, italic: false });
    expect(value.bold).toBe(false);
  });

  it('numbers ordered-list items', () => {
    const blocks = parse(
      '<ol><li>First term.</li><li>Second term.</li><li>Third term.</li></ol>',
    );

    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.marker)).toEqual(['1.', '2.', '3.']);
    // The old renderer emitted unnumbered terms; the numbering is semantic.
    expect(blocks[0].kind).toBe('li');
  });

  it('bullets unordered lists and restarts numbering per list', () => {
    const blocks = parse(
      '<ul><li>Bullet.</li></ul><ol><li>One.</li></ol><ol><li>Restarted.</li></ol>',
    );

    expect(blocks[0].marker).toBe('•');
    expect(blocks[1].marker).toBe('1.');
    expect(blocks[2].marker).toBe('1.');
  });

  it('keeps headings as their own blocks', () => {
    const blocks = parse(
      '<h1>PAWN LOAN AGREEMENT</h1><h2>PARTIES</h2><h2>LOAN DETAILS</h2>',
    );

    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'h2', 'h2']);
  });

  it('decodes entities rather than printing them', () => {
    const [block] = parse('<p>Legal name &amp; Co &lt;test&gt;</p>');
    const text = block.lines[0].map((r: any) => r.text).join('');

    expect(text).toBe('Legal name & Co <test>');
  });

  it('does not treat a bolded phrase as a heading', () => {
    // The old renderer classified anything matching /^[A-Z\s]+$/ as a heading,
    // which underlined whole uppercase sentences mid-paragraph.
    const blocks = parse('<p>FORFEITED means the lender takes the collateral.</p>');

    expect(blocks[0].kind).toBe('p');
  });

  it('drops blocks that are only whitespace', () => {
    expect(parse('<p>   </p><p></p>')).toHaveLength(0);
  });

  it('survives unbalanced tags from a hand-edited template', () => {
    const blocks = parse('<p><strong>Unclosed label: value</p><h2>NEXT</h2>');

    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[blocks.length - 1].kind).toBe('h2');
  });

  it('handles a custom clause injected before the signature anchor', () => {
    // `applyExtraSections` splices shop-specific terms in, so the parser has to
    // accept them in the shape it produces.
    const blocks = parse(
      '<h2>TERMS AND CONDITIONS</h2><ol><li>Standard term.</li></ol>' +
      '<h2>SHOP-SPECIFIC TERMS</h2><p>Custom clause body.</p>',
    );

    expect(blocks.some((b) => b.kind === 'li')).toBe(true);
    expect(blocks.some((b) => b.kind === 'p')).toBe(true);
  });
});

describe('splitLabelValue', () => {
  it('pairs a bolded colon-terminated label with its value', () => {
    const [block] = parse('<p><strong>Borrower:</strong> Juan Dela Cruz</p>');
    const [row] = split(block.lines);

    expect(row.label).toBe('Borrower');
    expect(row.value.map((r: any) => r.text).join('')).toBe('Juan Dela Cruz');
  });

  it('leaves an unlabelled paragraph as prose', () => {
    const [block] = parse('<p>The Borrower acknowledges receipt of the loan.</p>');
    const [row] = split(block.lines);

    expect(row.label).toBe('');
  });

  it('does not split a bolded value that is not a label', () => {
    // `**FORFEITED**` mid-sentence must stay prose, not become a label column.
    const [block] = parse('<p>Unpaid, the collateral is deemed <strong>FORFEITED</strong> entirely.</p>');
    const [row] = split(block.lines);

    expect(row.label).toBe('');
  });

  it('does not treat a bolded line with nothing after it as a label', () => {
    const [block] = parse('<p><strong>Note:</strong></p>');
    const [row] = split(block.lines);

    expect(row.label).toBe('');
  });
});

describe('stripSignatureBlock', () => {
  it('removes the template signature block so only one is printed', () => {
    // Printed twice in the shipped PDF: the template's blank rules, then the
    // renderer's signed block. A blank signature block above the real one
    // invites the question of which binds.
    const html =
      '<h2>TERMS AND CONDITIONS</h2><ol><li>Term.</li></ol>' +
      '<h2>SIGNATURES</h2><p>Borrower: ____  Date: ____</p>' +
      '<p><em>This document was legally binding.</em></p>';

    const stripped = strip(html);

    expect(stripped).not.toContain('SIGNATURES');
    expect(stripped).not.toContain('Borrower: ____');
    expect(stripped).toContain('TERMS AND CONDITIONS');
  });

  it('matches the heading regardless of case or attributes', () => {
    expect(strip('<h2 class="x">signatures</h2><p>gone</p>')).toBe('');
  });

  it('leaves a document with no signature section untouched', () => {
    const html = '<h1>PAWN LOAN AGREEMENT</h1><p>Body.</p>';
    expect(strip(html)).toBe(html);
  });
});
