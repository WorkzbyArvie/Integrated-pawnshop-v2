import { Link } from 'react-router-dom';
import '../App.css';

type Section = {
  heading: string;
  body: string[];
};

type Doc = {
  title: string;
  updated: string;
  intro: string;
  sections: Section[];
};

const DOCUMENTS: Record<string, Doc> = {
  '/privacy': {
    title: 'Privacy Policy',
    updated: 'Last updated: September 10, 2026',
    intro:
      'This Privacy Policy explains how PawnGold Auction House collects, uses, stores, and protects personal data, consistent with the Philippine Data Privacy Act of 2012 (RA 10173).',
    sections: [
      {
        heading: '1. Information We Collect',
        body: [
          'Account information: name, email address, and password (stored securely) when you register to bid.',
          'Identity verification (KYC): government ID details, date of birth, address, phone number, and a photo of yourself, collected to verify your identity before bidding.',
          'Bidding activity: the bids you place, auction lots you follow or win, and payment/settlement history.',
          'Usage logs: basic technical data such as timestamps and IP addresses for security. We do not build advertising or behavior-tracking profiles.',
        ],
      },
      {
        heading: '2. How We Use Information',
        body: [
          'To authenticate you and enforce auction eligibility and know-your-customer (KYC) checks.',
          'To operate live auctions, process bidder agreements and contracts for winning bids, and record your bids in an audit trail.',
          'To process payments and settlements through our payment processor.',
          'To respond to support requests and comply with legal obligations.',
        ],
      },
      {
        heading: '3. Local Storage and Cookies',
        body: [
          'PawnGold Auction House does not use tracking or advertising cookies and does not embed advertising or analytics trackers.',
          'We keep you signed in using browser local storage tokens that are essential for authentication, not for tracking.',
          'You can clear local storage through your browser settings, which will sign you out.',
        ],
      },
      {
        heading: '4. How We Share Information',
        body: [
          'We do not sell personal data.',
          'Information is shared only (a) with service providers that host the platform and process payments under confidentiality obligations, (b) when required by Philippine law, or (c) with your consent.',
          'Payment card details are handled solely by our payment processor and are not stored on our servers.',
        ],
      },
      {
        heading: '5. Retention and Your Rights',
        body: [
          'Account, KYC, and bidding records are retained while your account is active and for a reasonable period afterward for audit and compliance purposes.',
          'Under RA 10173 you may exercise rights to access, correct, object, block, erase, or port your personal data. Contact the development team identified in the Terms of Service to exercise these rights.',
          'You may also file a complaint with the National Privacy Commission of the Philippines.',
        ],
      },
      {
        heading: '6. Security',
        body: [
          'We apply reasonable safeguards including encryption in transit, role-based access, and audit logging. No method of storage is perfectly secure; you are responsible for protecting your login credentials.',
        ],
      },
    ],
  },
  '/cookies': {
    title: 'Cookie Policy',
    updated: 'Last updated: September 10, 2026',
    intro:
      'PawnGold Auction House is built for privacy: it does not use tracking cookies, advertising cookies, or third-party marketing pixels.',
    sections: [
      {
        heading: '1. Cookies',
        body: [
          'PawnGold Auction House does not place cookies in your browser for analytics, advertising, or cross-site tracking.',
        ],
      },
      {
        heading: '2. Local Storage',
        body: [
          'We use browser local storage only for essential purposes: authentication tokens that keep you signed in, lightweight UI preferences, and your cookie-notice preference.',
          'Local storage data is not shared with third parties and is not used to build profiles about you.',
        ],
      },
      {
        heading: '3. Third-Party Services',
        body: [
          'The platform relies on service providers for hosting and payments, which have their own policies. Payment data is handled by the payment processor subject to its practices.',
        ],
      },
      {
        heading: '4. Managing Local Storage',
        body: [
          'Clear local storage at any time through your browser privacy settings. Doing so signs you out but does not delete data stored on our servers.',
        ],
      },
    ],
  },
  '/refunds': {
    title: 'Refund & Cancellation Policy',
    updated: 'Last updated: September 10, 2026',
    intro:
      'This policy explains cancellation and refund rules for paid features and auction transactions on PawnGold Auction House.',
    sections: [
      {
        heading: '1. Auction Settlements',
        body: [
          'Winning bids are settled through the platform per the auction terms and the Terms of Service.',
          'Disputes about delivered items may be raised within the period stated in the Terms. Refund eligibility for a winning item is determined case by case in line with the Consumer Act of the Philippines (RA 7394).',
        ],
      },
      {
        heading: '2. Cancellation',
        body: [
          'You may stop using the auction house at any time. Accounts with unresolved winning-bid obligations must be settled before closure.',
        ],
      },
      {
        heading: '3. Refunds',
        body: [
          'If you believe you were charged in error, contact the development team within 30 days of the charge. Refunds, where granted, are issued to the original payment method.',
          'Refund eligibility is determined at our discretion and may be limited by the payment processor\u2019s rules.',
        ],
      },
      {
        heading: '4. Consumer Act Compliance',
        body: [
          'Where a provision of Philippine consumer law grants you a non-waivable right, that right prevails over any conflicting term in this policy.',
        ],
      },
    ],
  },
};

export default function LegalInfo() {
  const path = window.location.pathname;
  const doc = DOCUMENTS[path] ?? DOCUMENTS['/privacy'];

  return (
    <div className="section-padding" style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto' }}>
        <Link to="/" style={{ color: 'var(--gold)', fontSize: '0.9rem', textDecoration: 'underline', display: 'inline-block', marginBottom: '1.5rem' }}>
          &larr; Back to auction house
        </Link>
        <h1 style={{ fontFamily: 'var(--font-display)', marginTop: 0, marginBottom: '0.25rem' }}>{doc.title}</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 0 }}>{doc.updated}</p>
        <p
          style={{
            background: 'rgba(201,160,92,0.06)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            lineHeight: 1.6,
            color: 'var(--text)',
          }}
        >
          {doc.intro}
        </p>

        <div style={{ marginTop: '2rem', display: 'grid', gap: '1.75rem' }}>
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.15rem', margin: '0 0 0.5rem' }}>
                {section.heading}
              </h2>
              {section.body.map((paragraph, index) => (
                <p key={index} style={{ color: 'var(--text)', fontSize: '0.9rem', lineHeight: 1.65, margin: '0.5rem 0' }}>
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', lineHeight: 1.6, marginTop: '2.5rem' }}>
          PawnGold is an academic thesis and capstone project developed in Dasmarinas, Cavite, Philippines.
          It is provided for demonstration and educational purposes only and is not a registered financial
          institution, money service business, or pawnshop operator.
        </p>
      </div>
    </div>
  );
}