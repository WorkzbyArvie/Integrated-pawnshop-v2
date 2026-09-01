import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Clock,
  Eye,
  ArrowLeft,
  Gavel,
  Tag,
  TrendingUp,
  Loader2,
  ImageOff,
  Star,
} from 'lucide-react';
import { useToast } from '../App';
import { supabase } from '../lib/supabaseClient';
import { getBackendUrl } from '../lib/backendUrl';

interface AuctionMarketplaceProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

interface AuctionImage {
  id: number;
  url: string;
  sortOrder: number;
}

interface AuctionPawnshop {
  id: string;
  name: string;
  logoUrl?: string | null;
}

interface AuctionCategory {
  id: number;
  name: string;
}

interface AuctionTicket {
  id: number;
  ticketNumber: string;
  category: string;
  description: string;
}

interface AuctionListing {
  id: number;
  title: string;
  description?: string | null;
  startingPrice: number;
  reservePrice?: number | null;
  currentBid: number;
  bidCount: number;
  status: string;
  startAt?: string | null;
  endAt?: string | null;
  minBidIncrement: number;
  bidExtensionMin: number;
  pawnshop: AuctionPawnshop;
  category?: AuctionCategory | null;
  ticket: AuctionTicket;
  images: AuctionImage[];
}

interface AuctionRating {
  id: number;
  rating: number;
  comment?: string | null;
  ratingType: 'ITEM_QUALITY' | 'TRANSACTION_EXPERIENCE' | 'SELLER_RATING';
  customer: { fullName: string };
  createdAt: string;
}

interface RatingSummary {
  ratings: AuctionRating[];
  averageRating: number;
  totalRatings: number;
}

interface BidLeaderboardEntry {
  rank: number;
  bidderId: string;
  bidderName: string;
  bidderEmail?: string | null;
  highestBid: number;
  totalBids: number;
  lastBidAt?: string | null;
}

interface BidLeaderboard {
  listingId: number;
  totalBidders: number;
  topBidders: BidLeaderboardEntry[];
}

interface ProofTrailItem {
  proofNumber: string;
  recordType: string;
  title: string;
  summary: string;
  sourceHash: string;
  createdAt: string;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatCountdown = (endAt: string | null | undefined, now: number) => {
  if (!endAt) return { label: 'No end date', hours: '--', minutes: '--', seconds: '--', urgent: false };
  const diff = new Date(endAt).getTime() - now;
  if (diff <= 0) return { label: 'Ended', hours: '00', minutes: '00', seconds: '00', urgent: false };
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return {
    label: 'Ends in',
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
    urgent: diff < 1000 * 60 * 60, // less than 1 hour
  };
};

export function AuctionMarketplace({ branchId, activeBranchId }: AuctionMarketplaceProps) {
  const { showToast } = useToast();
  const backendUrl = getBackendUrl();

  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [now, setNow] = useState(Date.now());
  const [selectedListing, setSelectedListing] = useState<AuctionListing | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bidLeaderboard, setBidLeaderboard] = useState<BidLeaderboard | null>(null);
  const [bidLeaderboardLoading, setBidLeaderboardLoading] = useState(false);
  const [proofTrail, setProofTrail] = useState<ProofTrailItem[]>([]);
  const [proofTrailLoading, setProofTrailLoading] = useState(false);

  // Rating state
  const [ratingSummary, setRatingSummary] = useState<RatingSummary | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [myRating, setMyRating] = useState(5);
  const [myComment, setMyComment] = useState('');
  const [myRatingType, setMyRatingType] = useState<'ITEM_QUALITY' | 'TRANSACTION_EXPERIENCE' | 'SELLER_RATING'>('ITEM_QUALITY');
  const [submitRatingLoading, setSubmitRatingLoading] = useState(false);

  // Live countdown ticker
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  // Fetch live listings
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const params = new URLSearchParams();
    params.set('status', 'LIVE');
    params.set('limit', '50');
    if (branchId) params.set('pawnshopId', branchId);
    if (Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0) {
      params.set('branchId', String(activeBranchId));
    }

    fetch(`${backendUrl}/auction/listings?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load listings');
        return res.json();
      })
      .then((raw) => {
        if (!mounted) return;
        const data = raw?.data ?? raw;
        const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
        setListings(items);
      })
      .catch((err) => {
        if (!mounted) return;
        console.error('Marketplace fetch error:', err);
        showToast('Failed to load live auction listings', 'error');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [branchId, activeBranchId]);

  // Fetch single listing detail
  const viewDetail = async (listing: AuctionListing) => {
    setDetailLoading(true);
    setRatingSummary(null);
    setBidLeaderboard(null);
    setProofTrail([]);
    try {
      const res = await fetch(`${backendUrl}/auction/listings/${listing.id}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to load listing');
      const raw = await res.json();
      const data = raw?.data ?? raw;
      setSelectedListing(data);
      // Fetch ratings for this listing
      fetchRatings(data.id);
      fetchBidLeaderboard(data.id);
      fetchProofTrail(data.id);
    } catch {
      setSelectedListing(listing);
      fetchBidLeaderboard(listing.id);
      fetchProofTrail(listing.id);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchProofTrail = async (listingId: number) => {
    setProofTrailLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setProofTrail([]);
        return;
      }

      const res = await fetch(`${backendUrl}/auction/listings/${listingId}/proofs`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        setProofTrail([]);
        return;
      }

      const raw = await res.json();
      const data = raw?.data ?? raw;
      setProofTrail(Array.isArray(data) ? data.map((item: any) => ({
        proofNumber: String(item.proofNumber || item.proof_number || ''),
        recordType: String(item.recordType || item.record_type || ''),
        title: String(item.title || ''),
        summary: String(item.summary || ''),
        sourceHash: String(item.sourceHash || item.source_hash || ''),
        createdAt: String(item.createdAt || item.created_at || ''),
      })) : []);
    } catch {
      setProofTrail([]);
    } finally {
      setProofTrailLoading(false);
    }
  };

  const fetchBidLeaderboard = async (listingId: number) => {
    setBidLeaderboardLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setBidLeaderboard(null);
        return;
      }

      const res = await fetch(`${backendUrl}/auction/listings/${listingId}/leaderboard`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        setBidLeaderboard(null);
        return;
      }

      const raw = await res.json();
      const data = raw?.data ?? raw;
      setBidLeaderboard({
        listingId: Number(data?.listingId || listingId),
        totalBidders: Number(data?.totalBidders || 0),
        topBidders: Array.isArray(data?.topBidders) ? data.topBidders : [],
      });
    } catch {
      setBidLeaderboard(null);
    } finally {
      setBidLeaderboardLoading(false);
    }
  };

  const fetchRatings = async (listingId: number) => {
    setRatingLoading(true);
    try {
      const res = await fetch(`${backendUrl}/auction/listings/${listingId}/ratings`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const raw = await res.json();
        setRatingSummary(raw?.data ?? raw);
      }
    } catch {
      // silently fail
    } finally {
      setRatingLoading(false);
    }
  };

  const handleSubmitRating = async () => {
    if (!selectedListing) return;

    setSubmitRatingLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showToast('Please sign in to submit a rating', 'error');
        return;
      }

      const res = await fetch(`${backendUrl}/auction/listings/${selectedListing.id}/ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          rating: myRating,
          comment: myComment || undefined,
          ratingType: myRatingType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || 'Failed to submit rating');
      }

      showToast('Rating submitted!', 'success');
      setMyComment('');
      fetchRatings(selectedListing.id);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to submit rating', 'error');
    } finally {
      setSubmitRatingLoading(false);
    }
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    listings.forEach((l) => {
      set.add(l.ticket?.category || l.category?.name || 'General');
    });
    return Array.from(set);
  }, [listings]);

  const filteredListings = useMemo(() => {
    return listings.filter((l) => {
      const matchSearch =
        !search ||
        l.title.toLowerCase().includes(search.toLowerCase()) ||
        (l.ticket?.ticketNumber || '').toLowerCase().includes(search.toLowerCase());
      const cat = l.ticket?.category || l.category?.name || 'General';
      const matchCat = categoryFilter === 'all' || cat === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [listings, search, categoryFilter]);

  const liveCount = listings.filter(l => l.status === 'LIVE').length;
  const totalBids = listings.reduce((acc, l) => acc + (l.bidCount || 0), 0);
  const totalValue = listings.reduce((acc, l) => acc + (l.currentBid || l.startingPrice || 0), 0);

  // ==================== DETAIL VIEW ====================
  if (selectedListing) {
    const countdown = formatCountdown(selectedListing.endAt, now);
    const imageUrl = selectedListing.images?.[0]?.url;

    return (
      <>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <button
          onClick={() => setSelectedListing(null)}
          className="flex items-center gap-2 text-sm font-bold text-[#8A8279] hover:text-[#F5F0E8] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Live Auctions
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Image */}
          <div className="lg:col-span-3 bg-[#14141B] border border-[rgba(201,160,92,0.08)] rounded-[2.5rem] overflow-hidden shadow-sm min-h-[360px] flex items-center justify-center">
            {imageUrl ? (
              <img src={imageUrl} alt={selectedListing.title} className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-300">
                <ImageOff className="w-16 h-16" />
                <p className="text-[10px] font-black uppercase tracking-widest">No Image Available</p>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-[#14141B] border border-[rgba(201,160,92,0.08)] rounded-[2.5rem] p-8 shadow-sm space-y-6">
              <div>
                <span className="text-[10px] font-black text-[#C9A05C] uppercase tracking-widest">{selectedListing.pawnshop.name}</span>
                <h2 className="text-2xl font-black text-[#F5F0E8] mt-1 leading-tight">{selectedListing.title}</h2>
                <p className="text-sm text-[#8A8279] mt-2">#{selectedListing.ticket.ticketNumber}</p>
              </div>

              <p className="text-sm text-[#B8B0A4] leading-relaxed">
                {selectedListing.description || selectedListing.ticket.description || 'No description available.'}
              </p>

              <div className="grid grid-cols-2 gap-4 py-6 border-y border-[rgba(201,160,92,0.08)]">
                <div>
                  <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest mb-1">Current Bid</p>
                  <p className="text-2xl font-black text-[#C9A05C]">{formatCurrency(selectedListing.currentBid || selectedListing.startingPrice)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest mb-1">Starting Price</p>
                  <p className="text-2xl font-black text-[#F5F0E8]">{formatCurrency(selectedListing.startingPrice)}</p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">{countdown.label}</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { val: countdown.hours, label: 'Hours' },
                    { val: countdown.minutes, label: 'Min' },
                    { val: countdown.seconds, label: 'Sec' },
                  ].map((t) => (
                    <div key={t.label} className={`text-center p-3 rounded-2xl border ${countdown.urgent ? 'bg-rose-50 border-rose-200' : 'bg-[#1C1C26] border-[rgba(201,160,92,0.08)]'}`}>
                      <p className={`text-2xl font-black ${countdown.urgent ? 'text-rose-600' : 'text-[#F5F0E8]'}`}>{t.val}</p>
                      <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest">{t.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-1 text-center bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                  <p className="text-lg font-black text-[#F5F0E8]">{selectedListing.bidCount}</p>
                  <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest">Bids</p>
                </div>
                <div className="flex-1 text-center bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                  <p className="text-lg font-black text-[#F5F0E8]">{selectedListing.ticket.category || 'General'}</p>
                  <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest">Category</p>
                </div>
              </div>

              <div className="space-y-3 border border-[rgba(201,160,92,0.08)] rounded-2xl p-4 bg-[#1C1C26]/70">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Top Bidder Leaderboard</p>
                  {bidLeaderboard?.totalBidders ? (
                    <p className="text-[10px] font-bold text-[#8A8279]">{bidLeaderboard.totalBidders} bidder(s)</p>
                  ) : null}
                </div>

                {bidLeaderboardLoading ? (
                  <div className="py-4 text-center">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-300 mx-auto" />
                  </div>
                ) : bidLeaderboard?.topBidders?.length ? (
                  <div className="space-y-2">
                    {bidLeaderboard.topBidders.map((entry) => (
                      <div key={entry.bidderId} className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-[#8A8279] truncate">#{entry.rank} {entry.bidderName}</p>
                          <p className="text-[10px] text-[#8A8279] truncate">{entry.bidderEmail || entry.bidderId}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-[#C9A05C]">{formatCurrency(entry.highestBid)}</p>
                          <p className="text-[10px] text-[#8A8279]">{entry.totalBids} bid{entry.totalBids !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#8A8279]">No bids yet for this listing.</p>
                )}
              </div>

              {/* Auction Info */}
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-purple-50 p-3 rounded-2xl border border-purple-100">
                  <p className="text-sm font-black text-purple-700">{formatCurrency(selectedListing.minBidIncrement || 100)}</p>
                  <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">Min Increment</p>
                </div>
                <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100">
                  <p className="text-sm font-black text-amber-700">{selectedListing.bidExtensionMin || 5} min</p>
                  <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Anti-Snipe</p>
                </div>
              </div>

              <div className="space-y-3 border border-[rgba(201,160,92,0.08)] rounded-2xl p-4 bg-[#14141B]">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Private Proof Trail</p>
                  <p className="text-[10px] font-bold text-[#8A8279]">Visible to authenticated staff only</p>
                </div>

                {proofTrailLoading ? (
                  <div className="py-4 text-center">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-300 mx-auto" />
                  </div>
                ) : proofTrail.length > 0 ? (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {proofTrail.map((proof) => (
                      <div key={proof.proofNumber} className="rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-[#8A8279] truncate">{proof.title}</p>
                            <p className="text-[10px] text-[#8A8279] uppercase tracking-widest">{proof.recordType}</p>
                          </div>
                          <p className="text-[10px] font-bold text-[#8A8279] truncate">{proof.proofNumber}</p>
                        </div>
                        <p className="text-xs text-[#B8B0A4] mt-1">{proof.summary}</p>
                        <div className="flex items-center justify-between mt-2 text-[10px] text-[#8A8279]">
                          <span>{proof.createdAt ? new Date(proof.createdAt).toLocaleString('en-PH') : 'Unknown time'}</span>
                          <span>{proof.sourceHash ? `${proof.sourceHash.slice(0, 12)}...` : 'No hash'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#8A8279]">No private proof trail is available for this listing yet.</p>
                )}
              </div>

              {/* Pawnshop dashboard is view-only for live auctions */}
              {selectedListing.status === 'LIVE' && (
                <div className="space-y-3 pt-2 border-t border-[rgba(201,160,92,0.08)]">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                      Customer Bidding Only
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      Pawnshop dashboard users cannot place bids here. Customers must bid in the public Auction House.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Ratings Section */}
            <div className="bg-[#14141B] border border-[rgba(201,160,92,0.08)] rounded-[2.5rem] p-8 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-amber-500" />
                  <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Ratings & Feedback</p>
                </div>
                {ratingSummary && ratingSummary.totalRatings > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-lg font-black text-amber-600">{ratingSummary.averageRating}</span>
                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                    <span className="text-xs text-[#8A8279] font-bold">({ratingSummary.totalRatings})</span>
                  </div>
                )}
              </div>

              {/* Submit Rating (only for ENDED auctions) */}
              {(selectedListing.status === 'ENDED' || selectedListing.status === 'CANCELLED') && (
                <div className="space-y-3 p-4 bg-[#1C1C26] rounded-2xl">
                  <p className="text-xs font-bold text-[#B8B0A4]">Leave your rating</p>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setMyRating(star)}
                        className="transition-transform hover:scale-110"
                      >
                        <Star
                          className={`w-6 h-6 ${star <= myRating ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`}
                        />
                      </button>
                    ))}
                  </div>
                  <select
                    value={myRatingType}
                    onChange={(e) => setMyRatingType(e.target.value as any)}
                    className="w-full rounded-xl px-3 py-2 border border-[rgba(201,160,92,0.12)] text-sm font-bold text-[#8A8279]"
                  >
                    <option value="ITEM_QUALITY">Item Quality</option>
                    <option value="TRANSACTION_EXPERIENCE">Transaction Experience</option>
                    <option value="SELLER_RATING">Seller Rating</option>
                  </select>
                  <textarea
                    value={myComment}
                    onChange={(e) => setMyComment(e.target.value)}
                    placeholder="Write a comment (optional)..."
                    maxLength={500}
                    rows={3}
                    className="w-full rounded-xl px-3 py-2 border border-[rgba(201,160,92,0.12)] text-sm text-[#8A8279] resize-none focus:border-amber-300 focus:ring-0 transition-all"
                  />
                  <button
                    onClick={handleSubmitRating}
                    disabled={submitRatingLoading}
                    className="w-full bg-amber-500 text-white py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {submitRatingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Rating'}
                  </button>
                </div>
              )}

              {/* Existing Ratings List */}
              {ratingLoading ? (
                <div className="py-6 text-center">
                  <Loader2 className="w-6 h-6 text-slate-300 animate-spin mx-auto" />
                </div>
              ) : ratingSummary && ratingSummary.ratings.length > 0 ? (
                <div className="space-y-4 max-h-64 overflow-y-auto">
                  {ratingSummary.ratings.map((r) => (
                    <div key={r.id} className="flex gap-3 p-3 bg-[#1C1C26] rounded-xl">
                      <div className="flex-shrink-0 w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                        <span className="text-xs font-black text-amber-700">{r.rating}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-[#8A8279]">{r.customer.fullName}</p>
                          <span className="text-[9px] font-bold text-[#8A8279] uppercase">
                            {r.ratingType.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5 mt-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} className={`w-3 h-3 ${s <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
                          ))}
                        </div>
                        {r.comment && <p className="text-xs text-[#8A8279] mt-1">{r.comment}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#8A8279] text-center py-4">No ratings yet.</p>
              )}
            </div>

            {/* Additional images */}
            {selectedListing.images.length > 1 && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {selectedListing.images.slice(1).map((img) => (
                  <div key={img.id} className="w-20 h-20 rounded-2xl overflow-hidden border border-[rgba(201,160,92,0.08)] flex-shrink-0">
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      </>
    );
  }

  // ==================== LISTINGS VIEW ====================
  return (
    <>
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-[#F5F0E8] flex items-center gap-3 tracking-tight">
            <div className="p-2 bg-amber-500 rounded-xl shadow-lg shadow-amber-200">
              <Gavel className="w-6 h-6 text-white" />
            </div>
            Live Auctions
          </h1>
          <p className="text-[#8A8279] font-medium mt-1">
            Browse live auction listings from your pawnshop network.
          </p>
          <div className="mt-3 inline-flex items-center rounded-full border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] px-3 py-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#8A8279]">
              View Only for Pawnshop Team
            </span>
          </div>
        </div>

        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8A8279] group-focus-within:text-amber-500 transition-colors" />
          <input
            type="text"
            placeholder="Search listings or ticket numbers..."
            className="pl-12 pr-6 py-4 border border-[rgba(201,160,92,0.12)] rounded-2xl w-full md:w-80 focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 outline-none transition-all shadow-sm text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Analytics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#14141B] border border-[rgba(201,160,92,0.08)] p-6 rounded-[2rem] shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><Gavel className="w-4 h-4" /></div>
            <p className="text-[#8A8279] text-[10px] font-black uppercase tracking-widest">Live Listings</p>
          </div>
          <p className="text-3xl font-black text-[#F5F0E8]">{liveCount}</p>
        </div>

        <div className="bg-[#14141B] border border-[rgba(201,160,92,0.08)] p-6 rounded-[2rem] shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><TrendingUp className="w-4 h-4" /></div>
            <p className="text-[#8A8279] text-[10px] font-black uppercase tracking-widest">Total Bid Value</p>
          </div>
          <p className="text-3xl font-black text-[#F5F0E8]">{formatCurrency(totalValue)}</p>
        </div>

        <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl shadow-slate-200">
          <div className="flex justify-between items-start mb-4">
            <p className="text-[#8A8279] text-[10px] font-black uppercase tracking-widest">Total Bids</p>
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </div>
          <p className="text-3xl font-bold text-white leading-tight">{totalBids}</p>
        </div>
      </div>

      {/* Category Filters */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
              categoryFilter === 'all'
                ? 'bg-slate-900 text-white shadow-lg'
                : 'bg-[#14141B] border border-[rgba(201,160,92,0.12)] text-[#B8B0A4] hover:bg-[#1C1C26]'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                categoryFilter === cat
                  ? 'bg-slate-900 text-white shadow-lg'
                  : 'bg-[#14141B] border border-[rgba(201,160,92,0.12)] text-[#B8B0A4] hover:bg-[#1C1C26]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Listing Grid */}
      {loading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-10 h-10 text-amber-500 animate-spin mx-auto" />
          <p className="text-[#8A8279] text-[10px] font-black uppercase mt-4 tracking-widest">Loading live auctions...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredListings.length > 0 ? (
            filteredListings.map((listing) => {
              const countdown = formatCountdown(listing.endAt, now);
              const imageUrl = listing.images?.[0]?.url;
              const cat = listing.ticket?.category || listing.category?.name || 'General';

              return (
                <div
                  key={listing.id}
                  className="group bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-[2.5rem] overflow-hidden hover:shadow-2xl hover:shadow-amber-900/5 transition-all duration-500 flex flex-col"
                >
                  {/* Image Area */}
                  <div className="relative h-48 bg-[#1C1C26] overflow-hidden">
                    {imageUrl ? (
                      <img src={imageUrl} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-50">
                        <ImageOff className="w-10 h-10 text-slate-300" />
                      </div>
                    )}
                    <div className="absolute top-4 left-4 flex gap-2">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        countdown.urgent
                          ? 'bg-rose-500 text-white'
                          : 'bg-emerald-500 text-white'
                      }`}>
                        {countdown.urgent ? 'Ending Soon' : 'Live'}
                      </span>
                    </div>
                    <div className="absolute top-4 right-4">
                      <span className="px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full text-[10px] font-black text-[#8A8279]">
                        {listing.bidCount} bid{listing.bidCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-6 flex-1 flex flex-col gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest">{listing.pawnshop.name}</span>
                        <span className="text-slate-300">|</span>
                        <span className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest flex items-center gap-1">
                          <Tag className="w-3 h-3" /> {cat}
                        </span>
                      </div>
                      <h3 className="text-lg font-black text-[#F5F0E8] leading-tight group-hover:text-amber-600 transition-colors">
                        {listing.title}
                      </h3>
                      <p className="text-xs text-[#8A8279] mt-1">#{listing.ticket?.ticketNumber || 'N/A'}</p>
                    </div>

                    <div className="flex items-baseline justify-between mt-auto">
                      <div>
                        <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest">Current Bid</p>
                        <p className="text-xl font-black text-[#C9A05C]">{formatCurrency(listing.currentBid || listing.startingPrice)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black text-[#8A8279] uppercase tracking-widest flex items-center gap-1 justify-end">
                          <Clock className="w-3 h-3" /> {countdown.label}
                        </p>
                        <p className={`text-sm font-black ${countdown.urgent ? 'text-rose-600' : 'text-[#F5F0E8]'}`}>
                          {countdown.hours}h {countdown.minutes}m {countdown.seconds}s
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => viewDetail(listing)}
                      disabled={detailLoading}
                      className="w-full bg-slate-900 text-white py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all duration-300 flex items-center justify-center gap-2 active:scale-[0.98] shadow-lg"
                    >
                      <Eye className="w-4 h-4" /> View Auction
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full py-20 text-center bg-[#1C1C26] rounded-[3rem] border-2 border-dashed border-[rgba(201,160,92,0.12)]">
              <Gavel className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-[#8A8279] font-bold text-[10px] uppercase tracking-widest">
                {search || categoryFilter !== 'all'
                  ? 'No listings match your filters.'
                  : 'No live auctions at this time.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
