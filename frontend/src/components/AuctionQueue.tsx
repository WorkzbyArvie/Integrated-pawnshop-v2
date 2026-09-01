import { useEffect, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock, Gavel, ImageOff, Info, Loader2, Maximize, Package, Search, Tag, TrendingUp, X } from 'lucide-react';
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
  detailsPendingApproval?: boolean;
  detailsApprovalRecordId?: string | null;
}

export function AuctionQueue({ branchId, activeBranchId }: AuctionQueueProps) {
  const { showToast } = useToast();
  const STORAGE_BUCKET_CANDIDATES = ['kyc-documents', 'loan-documents', 'loan-contracts'];
  const [items, setItems] = useState<AuctionQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<AuctionQueueItem | null>(null);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [savingDetailsId, setSavingDetailsId] = useState<number | null>(null);
  const auctionBaseUrl = getAuctionFrontendUrl();

  useEffect(() => {
    const load = async () => {
      if (!selectedItem) {
        setSelectedImages([]);
        setLightboxIndex(null);
        return;
      }
      setLoadingImages(true);
      try {
        setSelectedImages(await resolveTicketImageUrls(selectedItem));
      } catch {
        setSelectedImages([]);
      } finally {
        setLoadingImages(false);
      }
    };
    load();
  }, [selectedItem?.id]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxIndex(null);
      } else if (e.key === 'ArrowRight' && selectedImages.length > 1) {
        setLightboxIndex((lightboxIndex + 1) % selectedImages.length);
      } else if (e.key === 'ArrowLeft' && selectedImages.length > 1) {
        setLightboxIndex((lightboxIndex - 1 + selectedImages.length) % selectedImages.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, selectedImages.length]);

  const updateItem = (id: number, patch: Partial<AuctionQueueItem>) => {
    setItems((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
    setSelectedItem((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  };

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
        itemCondition: ticket.itemCondition ?? '',
        itemSpecifications: ticket.itemSpecifications ?? '',
        provenanceDetails: ticket.provenanceDetails ?? '',
        disclosureNotes: ticket.disclosureNotes ?? '',
        detailsPendingApproval: Boolean(ticket.detailsPendingApproval),
        detailsApprovalRecordId: ticket.detailsApprovalRecordId ?? null,
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
      updateItem(item.id, { listingId: listing.id, listingStatus: published.status ?? 'LIVE' });
      setSelectedItem(null);
      window.open(`${auctionBaseUrl}/listing/${listing.id}`, '_blank');
    } catch (err: unknown) {
      console.error('Publish error:', err);
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to publish listing', 'error');
    } finally {
      setPublishingId(null);
    }
  };

  const handleSaveDetails = async (item: AuctionQueueItem) => {
    const isPublished =
      item.listingId &&
      (item.listingStatus === 'LIVE' || item.listingStatus === 'SCHEDULED');

    const confirm = await Swal.fire({
      title: isPublished ? 'Submit edit for approval?' : 'Save item details?',
      text: isPublished
        ? `Editing a published listing requires approval from an owner or higher. Continue?`
        : `Save the item details for ticket ${item.ticketNumber}?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: isPublished ? 'Submit for Approval' : 'Save Details',
      cancelButtonText: 'Cancel',
      reverseButtons: true,
      confirmButtonColor: '#C9A05C',
    });

    if (!confirm.isConfirmed) {
      return;
    }

    setSavingDetailsId(item.id);

    try {
      if (!item.listingId) {
        showToast('Item details saved — they will apply when this item is published', 'success');
        return;
      }

      const result = await api.patch<any>(
        `/auction/listings/${item.listingId}/details`,
        {
          itemCondition: item.itemCondition || undefined,
          itemSpecifications: item.itemSpecifications || undefined,
          provenanceDetails: item.provenanceDetails || undefined,
          disclosureNotes: item.disclosureNotes || undefined,
        },
      );

      if (result?.requestedApproval) {
        updateItem(item.id, {
          detailsPendingApproval: true,
          detailsApprovalRecordId: result.approvalRecordId ?? undefined,
        });
        showToast('Edit submitted for approval by an owner or higher', 'success');
      } else {
        updateItem(item.id, { detailsPendingApproval: false });
        showToast('Item details saved', 'success');
      }
    } catch (err: unknown) {
      console.error('Save details error:', err);
      showToast(
        err instanceof Error ? err.message : String(err) || 'Failed to save item details',
        'error',
      );
    } finally {
      setSavingDetailsId(null);
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
      cancelButtonColor: '#8A8279',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;

    setPublishingId(item.id);
    try {
      const cancelled = await api.patch<any>(`/auction/listings/${item.listingId}/cancel`);
      updateItem(item.id, { listingStatus: cancelled.status ?? 'CANCELLED' });
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
      cancelButtonColor: '#8A8279',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;

    setActionId(item.id);
    try {
      await api.patch(`/auction/queue/${item.id}/return`);

      setItems(prev => prev.filter(entry => entry.id !== item.id));
      setSelectedItem(null);
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
      cancelButtonColor: '#8A8279',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;

    setActionId(item.id);
    try {
      await api.patch(`/auction/queue/${item.id}/sold`);

      setItems(prev => prev.filter(entry => entry.id !== item.id));
      setSelectedItem(null);
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
    <>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-[#C9A05C] to-[#8a6d37] rounded-2xl shadow-lg shadow-[#C9A05C]/20">
              <Gavel className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-[#F5F0E8] tracking-tight" style={{ fontFamily: "'Syne', sans-serif" }}>
                Auction Queue
              </h1>
              <p className="text-[#8A8279] font-medium mt-1 text-sm">
                Items flagged for auction before publishing to the marketplace.
              </p>
            </div>
          </div>
        </div>

        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8A8279] group-focus-within:text-[#C9A05C] transition-colors" />
          <input
            type="text"
            placeholder="Search by ticket or item..."
            className="pl-12 pr-6 py-3.5 bg-[#1C1C26] border border-[rgba(201,160,92,0.12)] rounded-2xl w-full md:w-80 text-[#F5F0E8] placeholder-[#8A8279] focus:ring-4 focus:ring-[#C9A05C]/10 focus:border-[#C9A05C] outline-none transition-all shadow-lg shadow-black/20"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="relative overflow-hidden bg-[#14141B] border border-[rgba(201,160,92,0.1)] p-6 rounded-[2rem]">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#C9A05C]/5 rounded-full blur-2xl" />
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 bg-[#C9A05C]/10 text-[#C9A05C] rounded-xl"><Gavel className="w-4 h-4" /></div>
            <p className="text-[#8A8279] text-[10px] font-black uppercase tracking-widest">Queued Items</p>
          </div>
          <p className="text-4xl font-black text-[#F5F0E8]">{items.length}</p>
          <p className="text-[10px] text-[#8A8279] mt-2 uppercase tracking-wider">Ready for publication</p>
        </div>

        <div className="relative overflow-hidden bg-[#14141B] border border-[rgba(201,160,92,0.1)] p-6 rounded-[2rem]">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#4ade80]/5 rounded-full blur-2xl" />
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 bg-[#4ade80]/10 text-[#4ade80] rounded-xl"><TrendingUp className="w-4 h-4" /></div>
            <p className="text-[#8A8279] text-[10px] font-black uppercase tracking-widest">Target Recovery</p>
          </div>
          <p className="text-4xl font-black text-[#F5F0E8]">
            {formatCurrency(items.reduce((acc, curr) => acc + curr.auctionPrice, 0))}
          </p>
          <p className="text-[10px] text-[#8A8279] mt-2 uppercase tracking-wider">Cumulative reserve value</p>
        </div>

        <div className="relative overflow-hidden p-6 rounded-[2rem] bg-gradient-to-br from-[#C9A05C] to-[#8a6d37] shadow-lg shadow-[#C9A05C]/20">
          <p className="text-white/70 text-[10px] font-black uppercase tracking-widest">Queue Status</p>
          <div className="flex items-center gap-2 mt-3 mb-3">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/90">Awaiting Review</span>
          </div>
          <p className="text-xl font-bold text-white leading-tight" style={{ fontFamily: "'Syne', sans-serif" }}>
            Awaiting publishing approvals
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-10 h-10 text-[#C9A05C] animate-spin mx-auto" />
          <p className="text-[#8A8279] text-[10px] font-black uppercase mt-4 tracking-widest">Loading auction queue...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="border-2 border-dashed border-[rgba(201,160,92,0.1)] rounded-[2rem] flex flex-col items-center justify-center py-24 px-8 text-center">
          <Info className="w-8 h-8 text-[#8A8279] mb-4" />
          <p className="text-[#8A8279] font-black uppercase text-[10px] tracking-[0.3em]">
            No items currently marked for auction.
          </p>
        </div>
      ) : (
        <div className="bg-[#14141B] border border-[rgba(201,160,92,0.1)] rounded-[2rem] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[rgba(201,160,92,0.08)]">
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Ticket</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Item</th>
                  <th className="px-5 py-4 text-left text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Category</th>
                  <th className="px-5 py-4 text-right text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Loan</th>
                  <th className="px-5 py-4 text-right text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Recovery</th>
                  <th className="px-5 py-4 text-center text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Status</th>
                  <th className="px-5 py-4 text-center text-[10px] font-black uppercase tracking-wider text-[#8A8279]">Deadline</th>
                  <th className="px-5 py-4 text-right text-[10px] font-black uppercase tracking-wider text-[#8A8279]"></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const isPublished = item.listingStatus === 'LIVE' || item.listingStatus === 'SCHEDULED';
                  const badgeLabel = isPublished
                    ? 'Published'
                    : item.listingStatus === 'CANCELLED'
                      ? 'Cancelled'
                      : 'Queued';
                  const badgeClass = isPublished
                    ? 'text-[#4ade80] bg-[#4ade80]/10 border-[#4ade80]/20'
                    : item.listingStatus === 'CANCELLED'
                      ? 'text-[#D44545] bg-[#D44545]/10 border-[#D44545]/20'
                      : 'text-[#C9A05C] bg-[#C9A05C]/10 border-[#C9A05C]/20';
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className="border-b border-[rgba(201,160,92,0.04)] hover:bg-[rgba(201,160,92,0.03)] transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-4">
                        <span className="px-3 py-1 bg-[#1C1C26] text-[#B8B0A4] rounded-full text-[11px] font-black tracking-wider border border-[rgba(201,160,92,0.12)]">
                          {item.ticketNumber}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-bold text-[#F5F0E8] group-hover:text-[#C9A05C] transition-colors">
                          {item.description}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-1.5 font-bold text-[#8A8279]">
                          <Tag className="w-3.5 h-3.5 text-[#C9A05C]" /> {item.category}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-[#8A8279]">
                        {formatCurrency(item.loanAmount)}
                      </td>
                      <td className="px-5 py-4 text-right font-black text-[#C9A05C]">
                        {formatCurrency(item.auctionPrice)}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${badgeClass}`}>
                          {badgeLabel}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center text-[#8A8279] text-xs font-bold whitespace-nowrap">
                        {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : 'Not set'}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedItem(item); }}
                          className="px-4 py-2 rounded-xl bg-[#1C1C26] text-[#F5F0E8] text-[10px] font-black uppercase tracking-wider border border-[rgba(201,160,92,0.15)] hover:bg-[#C9A05C] hover:text-white hover:border-[#C9A05C] transition-all"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>

    {selectedItem && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={() => { if (publishingId !== selectedItem.id && actionId !== selectedItem.id) setSelectedItem(null); }}
      >
        <div
          className="bg-[#14141B] border border-[rgba(201,160,92,0.15)] rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4 animate-in fade-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-10 bg-[#14141B] border-b border-[rgba(201,160,92,0.1)] px-6 sm:px-8 py-5 flex items-start justify-between gap-4 rounded-t-[2.5rem]">
            <div className="flex flex-wrap items-center gap-3">
              <div className="p-2.5 bg-[#C9A05C]/10 text-[#C9A05C] rounded-xl">
                <Gavel className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-black text-[#F5F0E8] tracking-tight" style={{ fontFamily: "'Syne', sans-serif" }}>
                  Auction Details
                </h2>
                <p className="text-[10px] text-[#8A8279] font-bold uppercase tracking-wider">{selectedItem.ticketNumber}</p>
              </div>
            </div>
            <button
              onClick={() => setSelectedItem(null)}
              disabled={publishingId === selectedItem.id || actionId === selectedItem.id}
              className="w-10 h-10 rounded-xl bg-[#1C1C26] flex items-center justify-center hover:bg-[#222228] transition-colors disabled:opacity-50"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-[#B8B0A4]" />
            </button>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-2xl font-black text-[#F5F0E8] leading-tight" style={{ fontFamily: "'Syne', sans-serif" }}>
                {selectedItem.description}
              </h3>
              {(() => {
                const isPublished = selectedItem.listingStatus === 'LIVE' || selectedItem.listingStatus === 'SCHEDULED';
                const label = isPublished ? 'Published' : selectedItem.listingStatus === 'CANCELLED' ? 'Cancelled' : 'Queued';
                const cls = isPublished
                  ? 'text-[#4ade80] bg-[#4ade80]/10 border-[#4ade80]/20'
                  : selectedItem.listingStatus === 'CANCELLED'
                    ? 'text-[#D44545] bg-[#D44545]/10 border-[#D44545]/20'
                    : 'text-[#C9A05C] bg-[#C9A05C]/10 border-[#C9A05C]/20';
                return (
                  <span className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${cls}`}>
                    {label}
                  </span>
                );
              })()}
            </div>
            <p className="text-[#8A8279] text-sm flex items-center gap-2 font-medium">
              <Tag className="w-4 h-4 text-[#C9A05C]" /> {selectedItem.category}
            </p>

            <div className="mt-2">
              <p className="text-[10px] text-[#8A8279] uppercase font-black tracking-[0.1em] mb-3">Item Photos</p>
              {loadingImages ? (
                <div className="flex items-center justify-center gap-2 bg-[#1C1C26] border border-[rgba(201,160,92,0.1)] rounded-2xl h-48 text-[#8A8279] text-xs font-black uppercase tracking-widest">
                  <Loader2 className="w-4 h-4 text-[#C9A05C] animate-spin" /> Loading photos...
                </div>
              ) : selectedImages.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {selectedImages.map((src, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setLightboxIndex(idx)}
                      className="relative w-40 h-40 rounded-2xl overflow-hidden border border-[rgba(201,160,92,0.15)] bg-[#1C1C26] group/img cursor-zoom-in hover:border-[#C9A05C] hover:shadow-lg hover:shadow-[#C9A05C]/20 transition-all"
                      aria-label={`View ${selectedItem.description} photo ${idx + 1}`}
                    >
                      <img
                        src={src}
                        alt={`${selectedItem.description} photo ${idx + 1}`}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors">
                        <Maximize className="w-5 h-5 text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
                      </span>
                      {selectedImages.length > 1 && (
                        <span className="absolute top-2 right-2 px-2 py-0.5 bg-black/60 text-white text-[10px] font-black rounded-lg">
                          {idx + 1}/{selectedImages.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center bg-[#1C1C26] border border-dashed border-[rgba(201,160,92,0.15)] rounded-2xl h-40 text-[#8A8279]">
                  <div className="flex flex-col items-center gap-2">
                    <ImageOff className="w-6 h-6" />
                    <p className="text-[10px] font-black uppercase tracking-widest">No photo available</p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6 py-6 border-y border-[rgba(201,160,92,0.08)]">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-3.5 h-3.5 text-[#C9A05C]" />
                  <p className="text-[10px] text-[#8A8279] uppercase font-black tracking-[0.1em]">Loan Principal</p>
                </div>
                <p className="font-black text-[#F5F0E8] text-xl">{formatCurrency(selectedItem.loanAmount)}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-[#C9A05C]" />
                  <p className="text-[10px] text-[#C9A05C] uppercase font-black tracking-[0.1em]">Target Recovery</p>
                </div>
                <div className="flex items-center gap-1 bg-[#C9A05C]/10 border border-[#C9A05C]/20 rounded-xl px-3 py-2">
                  <span className="text-[#C9A05C] font-black text-lg">₱</span>
                  <input
                    type="number"
                    value={Math.round(selectedItem.auctionPrice)}
                    onChange={(e) => {
                      const newPrice = parseInt(e.target.value) || 0;
                      updateItem(selectedItem.id, { auctionPrice: newPrice });
                    }}
                    className="font-black text-[#C9A05C] bg-transparent w-full outline-none transition-all text-lg"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <label className="block">
                <span className="text-[10px] text-[#8A8279] uppercase font-black tracking-[0.1em] block mb-1">Item Condition</span>
                <input
                  type="text"
                  value={selectedItem.itemCondition}
                  onChange={(e) => updateItem(selectedItem.id, { itemCondition: e.target.value })}
                  className="w-full rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.12)] px-3 py-2.5 text-sm text-[#F5F0E8] placeholder-[#8A8279] focus:border-[#C9A05C] focus:outline-none transition-all"
                  placeholder="Item condition (e.g. Excellent, Good, Fair)"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-[#8A8279] uppercase font-black tracking-[0.1em] block mb-1">Item Specifications</span>
                <textarea
                  value={selectedItem.itemSpecifications}
                  onChange={(e) => updateItem(selectedItem.id, { itemSpecifications: e.target.value })}
                  className="w-full min-h-16 rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.12)] px-3 py-2.5 text-sm text-[#F5F0E8] placeholder-[#8A8279] focus:border-[#C9A05C] focus:outline-none transition-all resize-none"
                  placeholder="Item specifications (brand, model, size, material, serials)"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-[#8A8279] uppercase font-black tracking-[0.1em] block mb-1">Provenance Details</span>
                <textarea
                  value={selectedItem.provenanceDetails}
                  onChange={(e) => updateItem(selectedItem.id, { provenanceDetails: e.target.value })}
                  className="w-full min-h-16 rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.12)] px-3 py-2.5 text-sm text-[#F5F0E8] placeholder-[#8A8279] focus:border-[#C9A05C] focus:outline-none transition-all resize-none"
                  placeholder="Provenance details (history/source of item)"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-[#8A8279] uppercase font-black tracking-[0.1em] block mb-1">Disclosure Notes</span>
                <textarea
                  value={selectedItem.disclosureNotes}
                  onChange={(e) => updateItem(selectedItem.id, { disclosureNotes: e.target.value })}
                  className="w-full min-h-16 rounded-xl bg-[#1C1C26] border border-[rgba(201,160,92,0.12)] px-3 py-2.5 text-sm text-[#F5F0E8] placeholder-[#8A8279] focus:border-[#C9A05C] focus:outline-none transition-all resize-none"
                  placeholder="Disclosure notes (defects, missing accessories, known issues)"
                />
              </label>
            </div>

            {selectedItem.detailsPendingApproval && (
              <div className="flex items-start gap-3 bg-[#8a6d37]/15 border border-[#C9A05C]/30 rounded-2xl px-4 py-3">
                <Info className="w-4 h-4 text-[#C9A05C] mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-[#E5C88C]">
                    Edit Pending Approval
                  </p>
                  <p className="text-xs font-semibold text-[#8A8279] mt-0.5">
                    Changes you made to this published listing are awaiting review by an owner or higher. They will apply once approved.
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={() => handleSaveDetails(selectedItem)}
              disabled={savingDetailsId === selectedItem.id}
              className="w-full bg-[#1C1C26] text-[#E5C88C] py-3 rounded-2xl font-black text-xs uppercase tracking-widest border border-[#C9A05C]/30 hover:bg-[#C9A05C]/10 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {savingDetailsId === selectedItem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Item Details'}
            </button>

            <div className="flex items-center gap-2 text-[#8A8279] text-xs font-bold">
              <Calendar className="w-4 h-4 text-[#C9A05C]" />
              Deadline: {selectedItem.expiryDate ? new Date(selectedItem.expiryDate).toLocaleDateString() : 'Not set'}
            </div>

            {(!selectedItem.listingId || (selectedItem.listingStatus !== 'LIVE' && selectedItem.listingStatus !== 'SCHEDULED')) && (
              <div className="bg-[#1C1C26] rounded-2xl p-5 space-y-4 border border-[rgba(201,160,92,0.1)]">
                <p className="text-[10px] text-[#C9A05C] uppercase font-black tracking-[0.1em] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Auction Settings
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-[#8A8279] font-bold block mb-1.5">Min Bid Increment (₱)</label>
                    <input
                      type="number"
                      min={1}
                      value={selectedItem.minBidIncrement}
                      onChange={(e) => {
                        const v = parseInt(e.target.value) || 100;
                        updateItem(selectedItem.id, { minBidIncrement: v });
                      }}
                      className="w-full rounded-xl px-3 py-2.5 border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-sm font-bold text-[#F5F0E8] focus:border-[#C9A05C] focus:outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8A8279] font-bold block mb-1.5">Anti-Snipe Extension (min)</label>
                    <input
                      type="number"
                      min={1}
                      value={selectedItem.bidExtensionMin}
                      onChange={(e) => {
                        const v = parseInt(e.target.value) || 5;
                        updateItem(selectedItem.id, { bidExtensionMin: v });
                      }}
                      className="w-full rounded-xl px-3 py-2.5 border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-sm font-bold text-[#F5F0E8] focus:border-[#C9A05C] focus:outline-none transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[#8A8279] font-bold block mb-1.5">Auction Duration</label>
                  <select
                    value={selectedItem.durationHours}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      updateItem(selectedItem.id, { durationHours: v });
                    }}
                    className="w-full rounded-xl px-3 py-2.5 border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-sm font-bold text-[#F5F0E8] focus:border-[#C9A05C] focus:outline-none transition-all"
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
            )}
          </div>

          <div className="sticky bottom-0 bg-[#14141B] border-t border-[rgba(201,160,92,0.1)] px-6 sm:px-8 py-5 rounded-b-[2.5rem]">
            {selectedItem.listingId && (selectedItem.listingStatus === 'LIVE' || selectedItem.listingStatus === 'SCHEDULED') ? (
              <button
                onClick={() => handleCancel(selectedItem)}
                disabled={publishingId === selectedItem.id}
                className="w-full bg-[#1C1C26] text-[#F5F0E8] py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest border border-[#D44545]/30 hover:border-[#D44545] hover:text-[#D44545] shadow-lg transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {publishingId === selectedItem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Cancel Listing'}
              </button>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => handlePublish(selectedItem)}
                  disabled={publishingId === selectedItem.id}
                  className="w-full bg-gradient-to-r from-[#C9A05C] to-[#8a6d37] text-white py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:from-[#E5C88C] hover:to-[#C9A05C] shadow-lg shadow-[#C9A05C]/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {publishingId === selectedItem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Publish to Auction House'}
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleReturnToVault(selectedItem)}
                    disabled={actionId === selectedItem.id}
                    className="w-full bg-[#1C1C26] text-[#F5F0E8] py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-[rgba(201,160,92,0.15)] hover:bg-[#14141B] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {actionId === selectedItem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Return to Vault'}
                  </button>
                  <button
                    onClick={() => handleMarkSold(selectedItem)}
                    disabled={actionId === selectedItem.id}
                    className="w-full bg-gradient-to-r from-[#2f8f5b] to-[#1f6b43] text-white py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:from-[#3baa6c] hover:to-[#2f8f5b] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {actionId === selectedItem.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Mark Sold'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {lightboxIndex !== null && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
        onClick={() => setLightboxIndex(null)}
      >
        <button
          type="button"
          onClick={() => setLightboxIndex(null)}
          className="absolute top-5 right-5 w-11 h-11 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors z-10"
          aria-label="Close viewer"
        >
          <X className="w-6 h-6 text-white" />
        </button>

        {selectedImages.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + selectedImages.length) % selectedImages.length); }}
              className="absolute left-4 sm:left-8 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors z-10"
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-7 h-7 text-white" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % selectedImages.length); }}
              className="absolute right-4 sm:right-8 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors z-10"
              aria-label="Next photo"
            >
              <ChevronRight className="w-7 h-7 text-white" />
            </button>
          </>
        )}

        <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
          <img
            src={selectedImages[lightboxIndex]}
            alt={`${selectedItem?.description ?? 'Item'} photo ${lightboxIndex + 1}`}
            className="w-full max-h-[80vh] object-contain rounded-2xl"
          />
          <div className="flex items-center justify-center gap-2 mt-4">
            <p className="text-xs font-bold text-white/70 uppercase tracking-widest">
              {selectedItem?.ticketNumber} &middot; Photo {lightboxIndex + 1}
              {selectedImages.length > 1 ? ` of ${selectedImages.length}` : ''}
            </p>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
