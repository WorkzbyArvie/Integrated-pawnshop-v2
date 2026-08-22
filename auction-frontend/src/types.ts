export interface AuctionImage {
  id: number;
  url: string;
  sortOrder: number;
}

export interface AuctionPawnshop {
  id: string;
  name: string;
  logoUrl?: string | null;
}

export interface AuctionCategory {
  id: number;
  name: string;
}

export interface AuctionTicket {
  id: number;
  ticketNumber: string;
  category: string;
  description: string;
}

export interface AuctionBid {
  id: number;
  bidderId: string;
  amount: number;
  createdAt: string;
}

export interface AuctionListing {
  id: number;
  title: string;
  description?: string | null;
  startingPrice: number;
  minBidIncrement?: number;
  bidExtensionMin?: number;
  reservePrice?: number | null;
  currentBid: number;
  bidCount: number;
  status: string;
  startAt?: string | null;
  endAt?: string | null;
  pawnshop: AuctionPawnshop;
  category?: AuctionCategory | null;
  ticket: AuctionTicket;
  images: AuctionImage[];
  bids?: AuctionBid[];
}

export interface AuctionListResponse {
  items: AuctionListing[];
  nextCursor: number | null;
}
