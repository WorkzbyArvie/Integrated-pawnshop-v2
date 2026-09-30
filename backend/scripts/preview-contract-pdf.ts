/**
 * Renders the loan contract to a PDF on disk so the layout can be inspected
 * without a running backend. Dev-only; not part of the shipped bundle.
 *
 *   npx ts-node scripts/preview-contract-pdf.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { ContractRendererService } from '../src/contract/contract-renderer.service';

const TEMPLATE = Handlebars.compile(
  fs.readFileSync(path.join(__dirname, 'loan-contract.template.html'), 'utf8'),
);

const DATA = {
  contractNumber: 'CTR-MUNJDK96-D0253C4B',
  generatedDate: '9/30/2026',
  pawnshopLegalName: 'Cebuana',
  registrationNumber: 'Pending Registration',
  customerName: 'test',
  customerIdType: 'Valid ID',
  customerAddress: 'imus',
  loanAmount: '440.00',
  interestRate: '3.50',
  serviceFee: '4.40',
  serviceFeeRate: '1.00',
  loanTerm: '30 days',
  loanDate: '9/30/2026',
  maturityDate: '10/30/2026',
  graceDays: '90',
  latePenaltyRate: '3',
  itemDescription: 'test',
  itemCategory: 'Silver Jewelry',
  itemWeight: '10g',
};

async function main() {
  const service = new ContractRendererService({} as never, {} as never);
  // The renderer takes already-substituted HTML, exactly as `renderPdfOnly`
  // passes it after Handlebars has run.
  const html = TEMPLATE(DATA);

  // Unsigned, as generated at approval time.
  const unsigned = await (service as any).generatePdf(html, DATA);
  fs.writeFileSync(path.join(__dirname, 'contract-unsigned.pdf'), unsigned);

  // Signed, with a visible mark in each signature slot.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ).toString('base64');

  const signed = await (service as any).generatePdf(html, DATA, {
    customerSignature: `data:image/png;base64,${png}`,
    customerSignedAt: '2026-09-30T11:00:00.000Z',
    customerName: 'Juan Dela Cruz',
    staffSignature: `data:image/png;base64,${png}`,
    staffSignedAt: '2026-09-30T11:05:00.000Z',
    staffName: 'Maria Santos',
  });
  fs.writeFileSync(path.join(__dirname, 'contract-signed.pdf'), signed);

  // Signed, but the staff record was already gone at signing time - the name is
  // unknown, so the block must still render with its ruled line and placeholder.
  const halfSigned = await (service as any).generatePdf(html, DATA, {
    customerSignature: `data:image/png;base64,${png}`,
    customerSignedAt: '2026-09-30T11:00:00.000Z',
    customerName: 'Juan Dela Cruz',
  });
  fs.writeFileSync(path.join(__dirname, 'contract-half-signed.pdf'), halfSigned);

  console.log('wrote contract-unsigned.pdf, contract-signed.pdf and contract-half-signed.pdf');
}

void main();
