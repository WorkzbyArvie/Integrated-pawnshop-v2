export interface AgreementTemplateValues {
  bidderName?: string;
  bidderAddress?: string;
  bidderId?: string;
  pawnshopName?: string;
  listingTitle?: string;
  winningBid?: string;
  auctionDate?: string;
  agreementNumber?: string;
  generatedDate?: string;
  complianceHours?: string;
  [key: string]: string | undefined;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2,
  }).format(value || 0);

const today = () => new Date().toLocaleDateString('en-PH');

export function renderAgreementTemplate(
  content: string,
  values: AgreementTemplateValues = {},
): string {
  const defaults: AgreementTemplateValues = {
    bidderName: values.bidderName || '',
    bidderAddress: values.bidderAddress || '',
    bidderId: values.bidderId || '',
    pawnshopName: values.pawnshopName || 'PawnGold',
    pawnshopLegalName: values.pawnshopName || 'PawnGold',
    listingTitle: values.listingTitle || '',
    winningBid: values.winningBid || '',
    auctionDate: values.auctionDate || today(),
    agreementNumber: values.agreementNumber || `WON-${Date.now().toString(36).toUpperCase()}`,
    generatedDate: values.generatedDate || today(),
    complianceHours: values.complianceHours || '48',
  };

  const merged = { ...defaults, ...values };

  let rendered = content;
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) continue;
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  rendered = rendered.replace(/\{\{[a-zA-Z0-9_]+}}/g, 'N/A');

  return rendered;
}

export function winningBidText(value: number | undefined): string {
  return value === undefined ? '0.00' : formatCurrency(value);
}

export function agreementNumberFor(id: string): string {
  return `WON-${id.split('-')[0]?.toUpperCase() || Date.now().toString(36).toUpperCase()}`;
}
