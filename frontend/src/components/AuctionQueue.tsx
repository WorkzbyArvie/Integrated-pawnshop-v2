import { useEffect, useState } from 'react';
import { Calendar, Clock, Gavel, Loader2, Search, Tag, TrendingUp } from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../App';
import { getAuctionFrontendUrl } from '../lib/backendUrl';
import api from '@/lib/apiClient';
import { formatCurrency } from '@/lib/formatters';

interface AuctionQueueProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

interface AuctionQueueItem {
  id: number;
  ticketNumber: string;
  description: string;
  rawDescription: string;
  category: string;
  loanAmount: number;
  auctionPrice: number;
  expiryDate: string | null;
  listingId?: number | null;
  listingStatus?: string | null;
  minBidIncrement: number;
  durationHours: number;
  bidExtensionMin: number;
  itemCondition: string;
  itemSpecifications: string;
  provenanceDetails: string;
  disclosureNotes: string;
}

export function AuctionQueue({ branchId, activeBranchId }: AuctionQueueProps) {
  const { showToast } = useToast();
  const STORAGE_BUCKET_CANDIDATES = ['kyc-documents', 'loan-documents', 'loan-contracts'];
  const [items, setItems] = useState<AuctionQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const auctionBaseUrl = getAuctionFrontendUrl();

  const extractPhotoUrlsFromDescription = (text?: string | null): string[] => {
    if (!text) return [];
    const taggedListMatch = text.match(/\[PHOTO_URLS\]\s+(\[[\s\S]*?\])/i);
    if (taggedListMatch?.[1]) {
      try {
        const parsed = JSON.parse(taggedListMatch[1]);
        if (Array.isArray(parsed)) {
          return parsed.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
        }
      } catch {
        // Fall back to legacy parsing.
      }
    }

    const legacy = text.match(/\[PHOTO_URL\]\s+(https?:\/\/\S+)/i);
    return legacy?.[1] ? [legacy[1]] : [];
  };

  const sanitizeDescription = (text?: string | null): string => {
    if (!text) return 'Unlabeled Asset';
    return text
      .replace(/\n?\s*\[PHOTO_URL\]\s+https?:\/\/\S+/gi, '')
      .replace(/\n?\s*\[PHOTO_URLS\]\s+\[[\s\S]*?\]/gi, '')
      .trim() || 'Unlabeled Asset';
  };

  const resolveTicketImageUrls = async (item: AuctionQueueItem): Promise<string[]> => {
    const tagged = extractPhotoUrlsFromDescription(item.rawDescription);
    if (tagged.length) return tagged;

    for (const bucket of STORAGE_BUCKET_CANDIDATES) {
      const { data: files, error } = await supabase.storage
        .from(bucket)
        .list('appraisal-items', {
          limit: 100,
          search: item.ticketNumber,
        });

      if (error) {
        const message = String((error as any)?.message || '').toLowerCase();
        if (message.includes('bucket not found')) {
          continue;
        }
        return [];
      }

      if (!files?.length) {
        continue;
      }

      const matching = files
        .filter((file) => file.name.startsWith(`${item.ticketNumber}-`) || file.name === `${item.ticketNumber}.jpg`)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      if (!matching.length) {
        continue;
      }

      return matching.map((file) => {
        const { data } = supabase.storage
          .from(bucket)
          .getPublicUrl(`appraisal-items/${file.name}`);
        return data.publicUrl;
      });
    }

    return [];
  };

  const fetchAuctionQueue = async () => {
    setIsLoading(true);

    try {
      const parsedBranchId = Number.isInteger(activeBranchId as number)
        ? Number(activeBranchId)
        : NaN;
      const unwrapped = await api.get<any[]>('/auction/queue', {
        branchId: Number.isFinite(parsedBranchId) && parsedBranchId > 0 ? parsedBranchId : undefined,
      });
      const formatted = (unwrapped || []).map((ticket: any) => ({
        id: Number(ticket.id),
        ticketNumber: ticket.ticketNumber || 'N/A',
        rawDescription: ticket.description || 'Unlabeled Asset',
        description: sanitizeDescription(ticket.description),
        category: ticket.category || 'General',
        loanAmount: Number(ticket.loanAmount || 0),
        auctionPrice: Math.round(Number(ticket.loanAmount || 0) * 1.1),
        expiryDate: ticket.expiryDate || null,
        listingId: ticket.listingId ?? null,
        listingStatus: ticket.listingStatus ?? null,
        minBidIncrement: 100,
        durationHours: 168, // 7 days default 
        bidExtensionMin: 5,
        itemCondition: 'Pre-owned',
        itemSpecifications: '',
        provenanceDetails: '',
        disclosureNotes: '',
      }));

      setItems(formatted);
    } catch (err: unknown) {
      console.error('Auction queue fetch error:', err);
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to load auction queue', 'error');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAuctionQueue();
  }, [branchId, activeBranchId]);

  const handlePublish = async (item: AuctionQueueItem) => {
    const confirmation = await Swal.fire({
      title: 'Publish to Auction House?',
      text: `Publish ticket ${item.ticketNumber} now?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Publish',
      cancelButtonText: 'Cancel',
      reverseButtons: true,
      confirmButtonColor: '#4f46e5',
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    if (!item.auctionPrice || item.auctionPrice <= 0) {
      showToast('Set a valid auction price before publishing', 'error');
      return;
    }

    setPublishingId(item.id);

    try {
      const shouldCreate = !item.listingId;
      const listing = shouldCreate
        ? await (async () => {
            return api.post<any>('/auction/listings', {
                ticketId: item.id,
                title: item.description,
                description: item.description,
                startingPrice: item.auctionPrice,
                minBidIncrement: item.minBidIncrement,
                bidExtensionMin: item.bidExtensionMin,
                itemCondition: item.itemCondition,
                itemSpecifications: item.itemSpecifications || undefined,
                provenanceDetails: item.provenanceDetails || undefined,
                disclosureNotes: item.disclosureNotes || undefined,
                imageUrls: await resolveTicketImageUrls(item),
            });
          })()
        : { id: item.listingId };
      const endAt = new Date(Date.now() + item.durationHours * 60 * 60 * 1000).toISOString();

      const published = await api.patch<any>(`/auction/listings/${listing.id}/publish`, {
        endAt,
        durationHours: item.durationHours,
      });

      showToast(`Ticket ${item.ticketNumber} published to Auction House`, 'success');
      setItems(prev => prev.map(entry => (
        entry.id === item.id
          ? { ...entry, listingId: listing.id, listingStatus: published.status ?? 'LIVE' }
          : entry
      )));
      window.open(`${auctionBaseUrl}/listing/${listing.id}`, '_blank');
    } catch (err: unknown) {
      console.error('Publish error:', err);
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to publish listing', 'error');
    } finally {
      setPublishingId(null);
    }
  };

  const handleCancel = async (item: AuctionQueueItem) => {
    if (!item.listingId) return;
    const confirm = await Swal.fire({
      title: 'Are you sure?',
      text: `Cancel auction listing for ticket ${item.ticketNumber}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6B655C',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;

    setPublishingId(item.id);
    try {
      const cancelled = await api.patch<any>(`/auction/listings/${item.listingId}/cancel`);
      setItems(prev => prev.map(entry => (
        entry.id === item.id
          ? { ...entry, listingStatus: cancelled.status ?? 'CANCELLED' }
          : entry
      )));
      showToast(`Ticket ${item.ticketNumber} returned to auction queue`, 'success');
    } catch (err: unknown) {
      console.error('Cancel error:', err);
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to cancel listing', 'error');
    } finally {
      setPublishingId(null);
    }
  };

  const handleReturnToVault = async (item: AuctionQueueItem) => {
    if (item.listingStatus === 'LIVE' || item.listingStatus === 'SCHEDULED') {
      showToast('Cancel the listing before returning to vault', 'error');
      return;
    }
    const confirm = await Swal.fire({
      title: 'Are you sure?',
      text: `Return ticket ${item.ticketNumber} to vault? This removes it from the auction queue.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6B655C',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;

    setActionId(item.id);
    try {
      await api.patch(`/auction/queue/${item.id}/return`);

      setItems(prev => prev.filter(entry => entry.id !== item.id));
      showToast(`Ticket ${item.ticketNumber} returned to vault`, 'success');
    } catch (err: unknown) {
      console.error('Return to vault error:', err);
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to return item to vault', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleMarkSold = async (item: AuctionQueueItem) => {
    if (item.listingStatus === 'LIVE' || item.listingStatus === 'SCHEDULED') {
      showToast('Cancel the listing before marking as sold', 'error');
      return;
    }
    const confirm = await Swal.fire({
      title: 'Are you sure?',
      text: `Mark ticket ${item.ticketNumber} as sold? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6B655C',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;

    setActionId(item.id);
    try {
      await api.patch(`/auction/queue/${item.id}/sold`);

      setItems(prev => prev.filter(entry => entry.id !== item.id));
      showToast(`Ticket ${item.ticketNumber} marked as sold`, 'success');
    } catch (err: unknown) {
      console.error('Mark sold error:', err);
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to mark item as sold', 'error');
    } finally {
      setActionId(null);
    }
  };

  const filteredItems = items.filter(item => {
    const query = searchTerm.toLowerCase();
    return (
      item.ticketNumber.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-[#EAE2D6] flex items-center gap-3 tracking-tight">
            <div className="p-2 bg-purple-600 rounded-xl shadow-lg shadow-purple-200">
              <Gavel className="w-6 h-6 text-white" />
            </div>
            Auction Queue
          </h1>
          <p className="text-[#6B655C] font-medium mt-1">
            Items flagged for auction before publishing to the marketplace.
          </p>
        </div>

        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6B655C] group-focus-within:text-purple-500 transition-colors" />
          <input
            type="text"
            placeholder="Search by ticket or item..."
            className="pl-12 pr-6 py-4 border border-[rgba(201,160,92,0.12)] rounded-2xl w-full md:w-80 focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500 outline-none transition-all shadow-sm text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#14141B] border border-[rgba(201,160,92,0.08)] p-6 rounded-[2rem] shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><Gavel className="w-4 h-4" /></div>
            <p className="text-[#6B655C] text-[10px] font-black uppercase tracking-widest">Queued Items</p>
          </div>
          <p className="text-3xl font-black text-[#EAE2D6]">{items.length}</p>
        </div>

        <div className="bg-[#14141B] border border-[rgba(201,160,92,0.08)] p-6 rounded-[2rem] shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><TrendingUp className="w-4 h-4" /></div>
            <p className="text-[#6B655C] text-[10px] font-black uppercase tracking-widest">Target Recovery</p>
          </div>
          <p className="text-3xl font-black text-[#EAE2D6]">
            {formatCurrency(items.reduce((acc, curr) => acc + curr.auctionPrice, 0))}
          </p>
        </div>

        <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl shadow-slate-200">
          <p className="text-[#6B655C] text-[10px] font-black uppercase tracking-widest">Queue Status</p>
          <p className="text-xl font-bold text-white leading-tight mt-4">Awaiting publishing approvals</p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-10 h-10 text-purple-600 animate-spin mx-auto" />
          <p className="text-[#6B655C] text-[10px] font-black uppercase mt-4 tracking-widest">Loading auction queue...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <div key={item.id} className="group bg-[#14141B] border border-[rgba(201,160,92,0.12)] rounded-[2.5rem] overflow-hidden hover:shadow-2xl hover:shadow-purple-900/5 transition-all duration-500 flex flex-col">
                <div className="p-8 flex-1">
                  <div className="flex justify-between items-start mb-6">
                    <span className="px-4 py-1.5 bg-[#1C1C26] text-[#999186] rounded-full text-[11px] font-black tracking-wider border border-[rgba(201,160,92,0.12)]">
                      {item.ticketNumber}
                    </span>
                    <div className="flex items-center gap-1.5 text-purple-600 bg-purple-50 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tighter">
                      {item.listingStatus === 'LIVE' || item.listingStatus === 'SCHEDULED'
                        ? 'Published'
                        : item.listingStatus === 'CANCELLED'
                          ? 'Cancelled'
                          : 'Auction Queue'}
                    </div>
                  </div>

                  <h3 className="text-2xl font-black text-slate-800 mb-2 leading-tight group-hover:text-purple-600 transition-colors">
                    {item.description}
                  </h3>
                  <p className="text-[#6B655C] text-sm mb-6 flex items-center gap-2 font-medium">
                    <Tag className="w-4 h-4" /> {item.category}
                  </p>

                  <div className="grid grid-cols-2 gap-6 py-6 border-y border-slate-50 mb-8">
                    <div>
                      <p className="text-[10px] text-[#6B655C] uppercase font-black tracking-[0.1em] mb-1">Loan Principal</p>

                  <div className="mb-6 grid grid-cols-1 gap-3">
                    <input
                      type="text"
                      value={item.itemCondition}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((entry) =>
                            entry.id === item.id
                              ? { ...entry, itemCondition: e.target.value }
                              : entry,
                          ),
                        )
                      }
                      className="rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm"
                      placeholder="Item condition (e.g. Excellent, Good, Fair)"
                    />
                    <textarea
                      value={item.itemSpecifications}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((entry) =>
                            entry.id === item.id
                              ? { ...entry, itemSpecifications: e.target.value }
                              : entry,
                          ),
                        )
                      }
                      className="min-h-16 rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm"
                      placeholder="Item specifications (brand, model, size, material, serials)"
                    />
                    <textarea
                      value={item.provenanceDetails}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((entry) =>
                            entry.id === item.id
                              ? { ...entry, provenanceDetails: e.target.value }
                              : entry,
                          ),
                        )
                      }
                      className="min-h-16 rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm"
                      placeholder="Provenance details (history/source of item)"
                    />
                    <textarea
                      value={item.disclosureNotes}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((entry) =>
                            entry.id === item.id
                              ? { ...entry, disclosureNotes: e.target.value }
                              : entry,
                          ),
                        )
                      }
                      className="min-h-16 rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm"
                      placeholder="Disclosure notes (defects, missing accessories, known issues)"
                    />
                  </div>
                      <p className="font-bold text-[#6B655C] text-lg">{formatCurrency(item.loanAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-purple-500 uppercase font-black tracking-[0.1em] mb-1">Target Recovery</p>
                      <div className="flex items-center gap-1">
                        <span className="text-purple-600 font-bold text-lg">₱</span>
                        <input
                          type="number"
                          value={Math.round(item.auctionPrice)}
                          className="font-black text-purple-600 bg-purple-50/50 w-full rounded-xl px-3 py-1 border border-transparent focus:border-purple-200 focus:ring-0 transition-all text-lg"
                          onChange={(e) => {
                            const newPrice = parseInt(e.target.value) || 0;
                            setItems((prev) => prev.map(i => i.id === item.id ? { ...i, auctionPrice: newPrice } : i));
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[#6B655C] text-xs font-bold">
                    <Calendar className="w-4 h-4" />
                    Deadline: {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : 'Not set'}
                  </div>
                </div>

                <div className="px-8 pb-8">
                  {item.listingId && (item.listingStatus === 'LIVE' || item.listingStatus === 'SCHEDULED') ? (
                    <button
                      onClick={() => handleCancel(item)}
                      disabled={publishingId === item.id}
                      className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {publishingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Cancel Listing'}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      {/* Auction Settings */}
                      <div className="bg-[#1C1C26] rounded-2xl p-4 space-y-3 mb-2">
                        <p className="text-[10px] text-[#6B655C] uppercase font-black tracking-[0.1em] flex items-center gap-1"><Clock className="w-3 h-3" /> Auction Settings</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-[#6B655C] font-bold block mb-1">Min Bid Increment (₱)</label>
                            <input
                              type="number"
                              min={1}
                              value={item.minBidIncrement}
                              onChange={(e) => {
                                const v = parseInt(e.target.value) || 100;
                                setItems((prev) => prev.map(i => i.id === item.id ? { ...i, minBidIncrement: v } : i));
                              }}
                              className="w-full rounded-xl px-3 py-2 border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-sm font-bold text-[#6B655C] focus:border-purple-300 focus:ring-0 transition-all"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-[#6B655C] font-bold block mb-1">Anti-Snipe Extension (min)</label>
                            <input
                              type="number"
                              min={1}
                              value={item.bidExtensionMin}
                              onChange={(e) => {
                                const v = parseInt(e.target.value) || 5;
                                setItems((prev) => prev.map(i => i.id === item.id ? { ...i, bidExtensionMin: v } : i));
                              }}
                              className="w-full rounded-xl px-3 py-2 border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-sm font-bold text-[#6B655C] focus:border-purple-300 focus:ring-0 transition-all"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-[#6B655C] font-bold block mb-1">Auction Duration</label>
                          <select
                            value={item.durationHours}
                            onChange={(e) => {
                              const v = parseInt(e.target.value);
                              setItems((prev) => prev.map(i => i.id === item.id ? { ...i, durationHours: v } : i));
                            }}
                            className="w-full rounded-xl px-3 py-2 border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-sm font-bold text-[#6B655C] focus:border-purple-300 focus:ring-0 transition-all"
                          >
                            <option value={1}>1 Hour</option>
                            <option value={6}>6 Hours</option>
                            <option value={12}>12 Hours</option>
                            <option value={24}>1 Day</option>
                            <option value={48}>2 Days</option>
                            <option value={72}>3 Days</option>
                            <option value={168}>7 Days (Default)</option>
                            <option value={336}>14 Days</option>
                          </select>
                        </div>
                      </div>

                      <button
                        onClick={() => handlePublish(item)}
                        disabled={publishingId === item.id}
                        className="w-full bg-purple-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-purple-700 shadow-lg transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        {publishingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Publish to Auction House'}
                      </button>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => handleReturnToVault(item)}
                          disabled={actionId === item.id}
                          className="w-full bg-[#14141B] text-[#EAE2D6] py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-[rgba(201,160,92,0.12)] hover:bg-[#1C1C26] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                        >
                          {actionId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Return to Vault'}
                        </button>
                        <button
                          onClick={() => handleMarkSold(item)}
                          disabled={actionId === item.id}
                          className="w-full bg-emerald-600 text-white py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                        >
                          {actionId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Mark Sold'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-24 text-[#6B655C] font-bold">
              No items currently marked for auction.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
