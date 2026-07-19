import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding contract templates...');

  const loanContractTemplate = await prisma.contractTemplate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Standard Pawn Loan Agreement',
      type: 'LOAN_CONTRACT',
      version: '1.0',
      isActive: true,
      variables: JSON.stringify([
        'contractNumber', 'generatedDate', 'pawnshopLegalName', 'registrationNumber',
        'customerName', 'customerAddress', 'loanAmount', 'interestRate',
        'serviceFee', 'loanTerm', 'loanDate', 'maturityDate', 'graceDays',
        'latePenaltyRate', 'itemDescription', 'itemCategory', 'itemWeight',
      ]),
      content: `<h1>PAWN LOAN AGREEMENT</h1>
<p><strong>Contract No:</strong> {{contractNumber}}<br/>
<strong>Date:</strong> {{generatedDate}}</p>

<h2>PARTIES</h2>
<p><strong>Pawnshop:</strong> {{pawnshopLegalName}}<br/>
<strong>Registration No:</strong> {{registrationNumber}}<br/>
<strong>Borrower:</strong> {{customerName}}<br/>
<strong>Address:</strong> {{customerAddress}}</p>

<h2>LOAN DETAILS</h2>
<p><strong>Loan Amount:</strong> PHP {{loanAmount}}<br/>
<strong>Interest Rate:</strong> {{interestRate}}% per month<br/>
<strong>Service Fee:</strong> PHP {{serviceFee}} ({{serviceFeeRate}}%)<br/>
<strong>Loan Term:</strong> {{loanTerm}} months<br/>
<strong>Loan Date:</strong> {{loanDate}}<br/>
<strong>Maturity Date:</strong> {{maturityDate}}</p>

<h2>COLLATERAL</h2>
<p><strong>Item:</strong> {{itemDescription}}<br/>
<strong>Category:</strong> {{itemCategory}}<br/>
<strong>Weight:</strong> {{itemWeight}}</p>

<h2>TERMS AND CONDITIONS</h2>
<ol>
<li>The Borrower acknowledges receipt of the loan amount as stated above.</li>
<li>Interest accrues monthly at the stated rate. Unpaid interest does not compound.</li>
<li>A grace period of {{graceDays}} days is granted after the maturity date.</li>
<li>After the grace period, late penalties apply at {{latePenaltyRate}}% per month of the principal.</li>
<li>If unpaid after the grace period, the collateral shall be deemed FORFEITED.</li>
<li>Forfeited items may be sold through public auction without further notice.</li>
<li>The Borrower may redeem the collateral at any time before forfeiture by paying the full loan amount plus accrued interest.</li>
<li>This agreement is governed by Philippine laws, particularly the Pawnshop Regulation Act (RA 7306) and its implementing rules.</li>
</ol>

<h2>SIGNATURES</h2>
<p>Borrower: _________________________  Date: ___________<br/>
Pawnshop Representative: _________________________  Date: ___________</p>

<p><em>This document was electronically generated and is legally binding.</em></p>`,
    },
  });
  console.log(`✓ Loan Contract template: ${loanContractTemplate.id}`);

  const auctionBidderTemplate = await prisma.contractTemplate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Auction Bidder Agreement',
      type: 'AUCTION_BIDDER_AGREEMENT',
      version: '1.0',
      isActive: true,
      variables: JSON.stringify(['bidderName', 'bidderAddress', 'pawnshopName', 'listingTitle', 'winningBid', 'auctionDate']),
      content: `<h1>AUCTION BIDDER AGREEMENT</h1>
<p><strong>Date:</strong> {{auctionDate}}</p>

<h2>PARTIES</h2>
<p><strong>Auction House/Pawnshop:</strong> {{pawnshopName}}<br/>
<strong>Bidder:</strong> {{bidderName}}<br/>
<strong>Address:</strong> {{bidderAddress}}</p>

<h2>AUCTION DETAILS</h2>
<p><strong>Item:</strong> {{listingTitle}}<br/>
<strong>Winning Bid:</strong> PHP {{winningBid}}</p>

<h2>TERMS</h2>
<ol>
<li>The Bidder agrees to pay the winning bid amount within the compliance deadline.</li>
<li>Failure to pay within the deadline may result in forfeiture of the bid and transfer to the next highest bidder.</li>
<li>Items are sold "as is" with no warranty or return policy.</li>
<li>The Bidder acknowledges inspection of the item prior to bidding.</li>
</ol>

<p>Bidder Signature: _________________________  Date: ___________</p>`,
    },
  });
  console.log(`✓ Auction Bidder Agreement template: ${auctionBidderTemplate.id}`);

  const tosTemplate = await prisma.contractTemplate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Terms of Service',
      type: 'TERMS_OF_SERVICE',
      version: '1.0',
      isActive: true,
      variables: JSON.stringify(['pawnshopName', 'effectiveDate']),
      content: `<h1>TERMS OF SERVICE</h1>
<p><strong>{{pawnshopName}}</strong><br/>
<strong>Effective Date:</strong> {{effectiveDate}}</p>

<h2>GENERAL TERMS</h2>
<ol>
<li>By using our services, you agree to these Terms of Service.</li>
<li>All pawn transactions are governed by the Pawnshop Regulation Act (RA 7306).</li>
<li>Personal information is collected in compliance with the Data Privacy Act of 2012 (RA 10173).</li>
<li>The pawnshop reserves the right to verify customer identity before processing transactions.</li>
<li>All items pawned are subject to appraisal and the pawnshop's lending criteria.</li>
</ol>

<h2>PRIVACY</h2>
<p>Customer data is stored securely and used only for transaction processing, legal compliance, and service improvement. Data is not shared with third parties except as required by law.</p>

<p>By accepting these terms, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.</p>`,
    },
  });
  console.log(`✓ Terms of Service template: ${tosTemplate.id}`);

  console.log('\nDone! 3 contract templates seeded.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
