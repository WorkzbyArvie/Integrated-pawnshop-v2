import type { AuctionListResponse, AuctionListing } from '../types';
import { getBackendUrl } from '../lib/backendUrl';

const backendUrl = getBackendUrl();

export interface ListingQuery {
  status?: string;
  pawnshopId?: string;
  categoryId?: number;
  search?: string;
  limit?: number;
  cursor?: number;
}

export async function fetchListings(query: ListingQuery = {}): Promise<AuctionListResponse> {
  const params = new URLSearchParams();

  if (query.status) params.set('status', query.status);
  if (query.pawnshopId) params.set('pawnshopId', query.pawnshopId);
  if (query.categoryId) params.set('categoryId', String(query.categoryId));
  if (query.search) params.set('search', query.search);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', String(query.cursor));

  const url = `${backendUrl}/auction/listings?${params.toString()}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error('Failed to load auction listings');
  }

  const json = await response.json();
  return (json?.data ?? json) as AuctionListResponse;
}

export async function fetchListing(id: number): Promise<AuctionListing> {
  const response = await fetch(`${backendUrl}/auction/listings/${id}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Failed to load auction listing');
  }

  const json = await response.json();
  return (json?.data ?? json) as AuctionListing;
}

export async function checkTosStatus(
  accessToken: string,
): Promise<{ accepted: boolean; tosVersion: string | null; acceptedAt: string | null }> {
  const response = await fetch(`${backendUrl}/auction/bidders/tos-status`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to check TOS status');
  }

  const json = await response.json();
  return json?.data ?? json;
}

export interface TosTemplate {
  id: string;
  name: string;
  type: string;
  version: string;
  content: string;
  variables: string[];
  createdAt: string;
}

export interface TosClause {
  id: string;
  name: string;
  content: string;
  type: string | null;
  sortOrder: number;
  isMandatory: boolean;
}

export async function fetchTosTemplate(accessToken: string): Promise<{
  template: TosTemplate | null;
  clauses: TosClause[];
}> {
  const [templateRes, clausesRes] = await Promise.all([
    fetch(`${backendUrl}/contracts/templates?type=AUCTION_BIDDER_AGREEMENT`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }),
    fetch(`${backendUrl}/contracts/clauses?type=AUCTION_BIDDER_AGREEMENT`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }),
  ]);

  const templateJson = await templateRes.json().catch(() => ({}));
  const clausesJson = await clausesRes.json().catch(() => ({}));

  const templates: TosTemplate[] = templateJson?.data ?? templateJson ?? [];
  const clauses: TosClause[] = clausesJson?.data ?? clausesJson ?? [];

  return {
    template: Array.isArray(templates) ? templates[0] || null : null,
    clauses: Array.isArray(clauses) ? clauses : [],
  };
}

export async function acceptBidderTos(
  listingId: number,
  accessToken: string,
  signedName?: string,
): Promise<void> {
  const response = await fetch(`${backendUrl}/auction/bidders/accept-tos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ listingId, signedName }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to accept terms');
  }
}

export async function placeBid(
  listingId: number,
  amount: number,
  accessToken: string,
): Promise<{ bidId: number | null; currentBid: number; nextMinimumBid: number; extended: boolean }> {
  const response = await fetch(`${backendUrl}/auction/listings/${listingId}/bids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ amount }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to place bid');
  }

  const json = await response.json();
  return json?.data ?? json;
}

export interface MyBidItem {
  listingId: number;
  listingTitle: string;
  pawnshopName: string;
  pawnshopLogoUrl: string | null;
  imageUrl: string | null;
  currentBid: number;
  listingStatus: string;
  myMaxBid: number;
  myBidCount: number;
  lastBidAt: string;
}

export async function fetchMyBids(accessToken: string): Promise<MyBidItem[]> {
  const response = await fetch(`${backendUrl}/auction/bidders/my-bids`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to load your bids');
  }

  const json = await response.json();
  return json?.data ?? json;
}

export interface MyWinningItem {
  id: string;
  listingId: number;
  listingTitle: string;
  listingStatus: string;
  pawnshopName: string;
  pawnshopLogoUrl: string | null;
  imageUrl: string | null;
  winningBid: number;
  status: string;
  createdAt: string;
  compliedAt: string | null;
  complianceDeadline: string;
  paymentReference: string | null;
  contractSignedAt: string | null;
  signedName: string | null;
}

export async function fetchMyWinnings(accessToken: string): Promise<MyWinningItem[]> {
  const response = await fetch(`${backendUrl}/auction/bidders/my-winnings`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to load your winnings');
  }

  const json = await response.json();
  return json?.data ?? json;
}

export async function createPaymentCheckout(
  complianceId: string,
  accessToken: string,
): Promise<{ checkoutUrl: string; linkId: string; paymentId: string; amount: number }> {
  const response = await fetch(`${backendUrl}/auction/bidders/me/pay/${complianceId}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to create payment checkout');
  }

  const json = await response.json();
  return json?.data ?? json;
}

export async function signContract(
  complianceId: string,
  signedName: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch(`${backendUrl}/auction/settlements/${complianceId}/sign-contract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ signedName }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to sign contract');
  }
}

export async function simulatePaymentWebhook(
  complianceId: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch(`${backendUrl}/auction/payments/webhook/simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ complianceId }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to simulate payment');
  }
}

export interface AuctionReceipt {
  id: string;
  receiptNumber: string;
  receiptType: string;
  amount: number;
  customerName: string;
  lineItems: { description: string; amount: number }[];
  generatedAt: string;
  status: string;
}

export async function fetchReceiptsByAuction(listingId: number, accessToken: string): Promise<AuctionReceipt[]> {
  const response = await fetch(`${backendUrl}/receipts/by-reference/AUCTION/${listingId}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) return [];

  const json = await response.json();
  const data = json?.data ?? json;
  return Array.isArray(data) ? data : [];
}

export async function downloadReceiptPdf(receiptId: string): Promise<string> {
  const response = await fetch(`${backendUrl}/receipts/${receiptId}/pdf`);
  if (!response.ok) throw new Error('Failed to load receipt PDF');
  const json = await response.json();
  return json?.pdfUrl || `${backendUrl}/receipts/${receiptId}/pdf/download`;
}
