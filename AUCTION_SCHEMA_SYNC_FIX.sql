-- Auction schema sync fix for legacy environments
-- Run this in Supabase SQL Editor (safe to re-run).

DO $$ BEGIN
  CREATE TYPE public."AuctionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public."ListingOwnerType" AS ENUM ('PAWNSHOP', 'CUSTOMER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.auction_listings (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL UNIQUE,
  pawnshop_id UUID NOT NULL,
  category_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  starting_price DOUBLE PRECISION NOT NULL,
  reserve_price DOUBLE PRECISION,
  current_bid DOUBLE PRECISION NOT NULL DEFAULT 0,
  bid_count INTEGER NOT NULL DEFAULT 0,
  min_bid_increment DOUBLE PRECISION NOT NULL DEFAULT 100,
  bid_extension_min INTEGER NOT NULL DEFAULT 5,
  status public."AuctionStatus" NOT NULL DEFAULT 'DRAFT',
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  owner_type public."ListingOwnerType",
  owner_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auction_listings_ticket_fk FOREIGN KEY (ticket_id) REFERENCES public.ticket(id) ON DELETE CASCADE,
  CONSTRAINT auction_listings_pawnshop_fk FOREIGN KEY (pawnshop_id) REFERENCES public.pawnshops(id) ON DELETE CASCADE,
  CONSTRAINT auction_listings_category_fk FOREIGN KEY (category_id) REFERENCES public.category(id) ON DELETE SET NULL
);

ALTER TABLE public.auction_listings
  ADD COLUMN IF NOT EXISTS min_bid_increment DOUBLE PRECISION NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS bid_extension_min INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_type public."ListingOwnerType",
  ADD COLUMN IF NOT EXISTS owner_id TEXT;

CREATE TABLE IF NOT EXISTS public.auction_images (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auction_images_listing_fk FOREIGN KEY (listing_id) REFERENCES public.auction_listings(id) ON DELETE CASCADE
);

ALTER TABLE public.auction_images
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.auction_bids (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL,
  bidder_id UUID NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auction_bids_listing_fk FOREIGN KEY (listing_id) REFERENCES public.auction_listings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auction_bids_listing_idx ON public.auction_bids(listing_id);
CREATE INDEX IF NOT EXISTS auction_images_listing_idx ON public.auction_images(listing_id);
