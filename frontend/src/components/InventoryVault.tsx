import { useState, useEffect, useMemo } from 'react';
import { 
  Package, 
  Search, 
  Filter, 
  Calendar, 
  Weight, 
  TrendingUp, 
  ChevronDown,
  Loader2,
  Lock,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  Receipt,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { api } from '../lib/apiClient';
import { useToast } from '../App';
import { formatCurrency } from '../lib/formatters';
import { ReceiptViewer } from './ReceiptViewer';
import Swal from 'sweetalert2';

interface InventoryItem {
  id: string;
  ticketNumber: string;
  name: string; 
  rawDescription: string;
  photoUrls: string[];
  category: string;
  weight: number;
  pawnDate: string;
  expiryDate: string | null;
  forfeitureDate: string | null;
  estimatedValue: number;
  interestRate: number;
  isHighRisk: boolean;
  status: string;
  customerName: string;
  location: string;
  contractId: string | null;
}

interface InventoryVaultProps {
  branchId: string | null;
  activeBranchId?: number | null;
}

export function InventoryVault({ branchId, activeBranchId }: InventoryVaultProps) {
  const { showToast } = useToast();
  const STORAGE_BUCKET_CANDIDATES = ['kyc-documents', 'loan-documents', 'loan-contracts'];
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [selectedPhotoFiles, setSelectedPhotoFiles] = useState<File[]>([]);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [modalPhotoIndex, setModalPhotoIndex] = useState(0);
  const [cardPhotoIndexes, setCardPhotoIndexes] = useState<Record<string, number>>({});
  const [receiptTicketId, setReceiptTicketId] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  
  // Active branch context
  const activePawnshopId = branchId ?? null;
  const activeOperationalBranchId = Number.isInteger(activeBranchId as number) ? Number(activeBranchId) : NaN;
  const hasActiveOperationalBranch = Number.isInteger(activeOperationalBranchId) && activeOperationalBranchId > 0;

  useEffect(() => {
    fetchInventory();
  }, [activePawnshopId, activeOperationalBranchId]);

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
        // Fallback to legacy parsing.
      }
    }

    const legacy = text.match(/\[PHOTO_URL\]\s+(https?:\/\/\S+)/i);
    return legacy?.[1] ? [legacy[1]] : [];
  };

  const sanitizeDescription = (text?: string | null): string => {
    if (!text) return 'Asset';
    return text
      .replace(/\n?\s*\[PHOTO_URL\]\s+https?:\/\/\S+/gi, '')
      .replace(/\n?\s*\[PHOTO_URLS\]\s+\[[\s\S]*?\]/gi, '')
      .trim() || 'Asset';
  };

  const buildDescriptionWithPhotoUrls = (baseDescription: string, urls: string[]): string => {
    const cleanBase = sanitizeDescription(baseDescription);
    const dedupedUrls = Array.from(new Set(urls.filter((url) => typeof url === 'string' && url.length > 0)));
    if (dedupedUrls.length === 0) {
      return cleanBase;
    }
    return `${cleanBase}\n[PHOTO_URLS] ${JSON.stringify(dedupedUrls)}`;
  };

  const persistTicketPhotoUrls = async (item: InventoryItem, urls: string[]): Promise<string> => {
    const nextDescription = buildDescriptionWithPhotoUrls(
      item.rawDescription || item.name || item.category || 'Asset',
      urls,
    );

    const ticketId = Number(item.id);
    let updateQuery = supabase
      .from('ticket')
      .update({ description: nextDescription })
      .eq('id', Number.isNaN(ticketId) ? (item.id as any) : (ticketId as any));

    if (activePawnshopId) {
      updateQuery = updateQuery.eq('pawnshop_id', activePawnshopId as any);
    }
    if (hasActiveOperationalBranch) {
      updateQuery = updateQuery.eq('branch_id', activeOperationalBranchId as any);
    }

    const { data, error } = await updateQuery.select('id, description');

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Photo update blocked or record not found.');
    }

    return String(data[0]?.description || nextDescription);
  };

  const uploadTicketPhotos = async (ticketNumber: string, files: File[]): Promise<string[]> => {
    const stamp = Date.now();
    const uploaded: string[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const optimized = await compressImage(files[index]);
      const path = `appraisal-items/${ticketNumber}-${stamp}-${index + 1}.jpg`;
      let uploadedUrl: string | null = null;

      for (const bucket of STORAGE_BUCKET_CANDIDATES) {
        const { error } = await supabase.storage.from(bucket).upload(path, optimized, {
          upsert: true,
          contentType: optimized.type || 'image/jpeg',
        });

        if (!error) {
          const { data } = supabase.storage.from(bucket).getPublicUrl(path);
          uploadedUrl = `${data.publicUrl}?v=${Date.now()}`;
          break;
        }
      }

      if (!uploadedUrl) {
        throw new Error('Failed to save one or more item photos in configured storage bucket');
      }

      uploaded.push(uploadedUrl);
    }

    return uploaded;
  };

  const getTicketPhotoUrlFromBucket = async (bucket: string, ticketNumber: string): Promise<string | null> => {
    const { data: files, error } = await supabase.storage
      .from(bucket)
      .list('appraisal-items', {
        limit: 100,
        search: ticketNumber,
      });

    if (error || !files?.length) return null;

    const match = files
      .filter((file) => file.name.startsWith(`${ticketNumber}-`) || file.name === `${ticketNumber}.jpg`)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];

    if (!match) return null;

    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(`appraisal-items/${match.name}`);
    return data.publicUrl;
  };

  useEffect(() => {
    const loadSelectedPhoto = async () => {
      if (!selectedItem?.ticketNumber) {
        setSelectedPhotoUrl(null);
        return;
      }

      if (selectedItem.photoUrls.length) {
        const boundedIndex = Math.min(Math.max(modalPhotoIndex, 0), selectedItem.photoUrls.length - 1);
        setSelectedPhotoUrl(selectedItem.photoUrls[boundedIndex]);
        return;
      }

      for (const bucket of STORAGE_BUCKET_CANDIDATES) {
        const url = await getTicketPhotoUrlFromBucket(bucket, selectedItem.ticketNumber);
        if (url) {
          setSelectedPhotoUrl(`${url}?v=${Date.now()}`);
          return;
        }
      }

      setSelectedPhotoUrl(null);
    };

    setSelectedPhotoFiles([]);
    void loadSelectedPhoto();
  }, [selectedItem?.ticketNumber, selectedItem?.photoUrls, modalPhotoIndex]);

  const fetchInventory = async () => {
    setIsLoading(true);
    
    try {
      // Fetch from ticket table; storage_location and pawn_date are direct columns
      let query = supabase
        .from('ticket')
        .select(`
          id,
          ticket_number,
          category,
          description,
          weight,
          loan_amount,
          status,
          pawn_date,
          expiry_date,
          forfeituredate,
          interest_rate,
          ishighrisk,
          storage_location,
          pawnshop_id,
          contract_id,
          customer:customer_id (
            full_name
          )
        `)
        .in('status', ['ACTIVE', 'REDEEMED', 'AUCTION'])
        .order('pawn_date', { ascending: false });

      if (activePawnshopId) {
        query = query.eq('pawnshop_id', activePawnshopId as any);
      }
      if (hasActiveOperationalBranch) {
        query = query.eq('branch_id', activeOperationalBranchId as any);
      }

      const { data, error } = await query;

      if (error) throw error;

      const transformedData: InventoryItem[] = (data || []).map((ticket: any) => {
        const customerFullName = (ticket.customer?.full_name ?? (Array.isArray(ticket.customer) ? ticket.customer[0]?.full_name : undefined)) || 'Walk-in Customer';
        const photoUrls = extractPhotoUrlsFromDescription(ticket.description || '');
        const cleanedDescription = sanitizeDescription(ticket.description || ticket.category || 'Asset');

        const expiryDate = ticket.expiry_date ? new Date(ticket.expiry_date) : null;
        const forfeitureDate = ticket.forfeituredate
          ? new Date(ticket.forfeituredate)
          : expiryDate
            ? new Date(expiryDate.getTime() + 3 * 24 * 60 * 60 * 1000)
            : null;

        return {
          id: String(ticket.id),
          ticketNumber: ticket.ticket_number || 'N/A',
          name: cleanedDescription,
          rawDescription: ticket.description || '',
          photoUrls,
          category: ticket.category || 'Uncategorized',
          weight: Number(ticket.weight) || 0,
          pawnDate: ticket.pawn_date ? new Date(ticket.pawn_date).toISOString() : new Date().toISOString(),
          expiryDate: expiryDate ? expiryDate.toISOString() : null,
          forfeitureDate: forfeitureDate ? forfeitureDate.toISOString() : null,
          estimatedValue: Number(ticket.loan_amount) || 0,
          interestRate: Number(ticket.interest_rate) || 0,
          isHighRisk: Boolean(ticket.ishighrisk),
          status: (ticket.status || 'ACTIVE').toUpperCase(),
          customerName: customerFullName,
          location: ticket.storage_location || 'Main Vault',
          contractId: ticket.contract_id || null,
        } as InventoryItem;
      });

      setItems(transformedData);
    } catch (err) {
      console.error('Error fetching inventory:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkForAuction = async (item: InventoryItem) => {
    if (item.status !== 'ACTIVE') return;
    const confirm = await Swal.fire({
      title: 'Confirm Action',
      text: `Mark ticket ${item.ticketNumber} for auction? This will move the item out of the vault.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#C9A05C',
      cancelButtonColor: '#6B655C',
      confirmButtonText: 'Yes, proceed',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;

    setUpdatingId(item.id);
    try {
      const result = await api.post(`/pawn-tickets/${item.id}/send-to-auction`);

      setItems(prev => prev.map(entry => (entry.id === item.id ? { ...entry, status: 'AUCTION' } : entry)));
      showToast(`Ticket ${item.ticketNumber} queued for auction`, 'success');
    } catch (err: unknown) {
      console.error('Mark for auction failed:', err);
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleShowContract = async (item: InventoryItem) => {
    if (!item.contractId) return;
    try {
      const headers: Record<string, string> = {};
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      const pawnshopId = localStorage.getItem('active_pawnshop_id') ?? '';
      if (pawnshopId) headers['pawnshop-id'] = pawnshopId;

      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const res = await fetch(`${backendUrl}/loan/contracts/${item.contractId}/pdf`, { headers });
      if (!res.ok) throw new Error('Failed to fetch contract PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to open contract', 'error');
    }
  };

  const formatTotalValue = (value: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const s = status?.toUpperCase();
    const baseClass = "inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border";
    
    switch(s) {
      case 'ACTIVE':
        return <span className={`${baseClass} bg-[#C9A05C]/10 text-[#C9A05C] border-blue-100`}><Lock className="w-2 h-2 mr-1"/> In Vault</span>;
      case 'REDEEMED':
        return <span className={`${baseClass} bg-emerald-50 text-emerald-600 border-emerald-100`}>Released</span>;
      case 'AUCTION':
        return <span className={`${baseClass} bg-purple-50 text-purple-600 border-purple-100`}>For Auction</span>;
      default:
        return <span className={`${baseClass} bg-[#1C1C26] text-[#999186] border-[rgba(201,160,92,0.08)]`}>{status}</span>;
    }
  };

  const getDaysRemaining = (date: string | null) => {
    if (!date) return null;
    const diffMs = new Date(date).getTime() - Date.now();
    return Math.ceil(diffMs / 86400000);
  };

  const getDeadlineTone = (daysRemaining: number | null) => {
    if (daysRemaining == null) return 'text-[#6B655C]';
    if (daysRemaining < 0) return 'text-rose-600 font-black';
    if (daysRemaining <= 7) return 'text-amber-600 font-black';
    return 'text-emerald-600 font-bold';
  };

  const compressImage = async (file: File): Promise<File> => {
    if (!file.type.startsWith('image/')) return file;

    const bitmap = await createImageBitmap(file);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Image compression failed'));
      }, 'image/jpeg', 0.82);
    });

    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  };

  const handleSavePhoto = async () => {
    if (!selectedItem || selectedPhotoFiles.length === 0) return;

    setIsSavingPhoto(true);
    try {
      const uploadedUrls = await uploadTicketPhotos(selectedItem.ticketNumber, selectedPhotoFiles);
      const mergedUrls = Array.from(new Set([...selectedItem.photoUrls, ...uploadedUrls]));
      const savedDescription = await persistTicketPhotoUrls(selectedItem, mergedUrls);

      setSelectedPhotoUrl(uploadedUrls[0] || selectedPhotoUrl);
      setSelectedItem((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rawDescription: savedDescription,
          photoUrls: mergedUrls,
        };
      });
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === selectedItem.id
            ? {
                ...entry,
                rawDescription: savedDescription,
                photoUrls: mergedUrls,
              }
            : entry,
        ),
      );
      setSelectedPhotoFiles([]);
      showToast(`${uploadedUrls.length} photo(s) saved successfully`, 'success');
    } catch (err: unknown) {
      console.error('Photo update failed:', err);
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setIsSavingPhoto(false);
    }
  };

  const handleQuickPhotoChange = async (item: InventoryItem) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;

      try {
        setUpdatingId(item.id);
        const uploadedUrls = await uploadTicketPhotos(item.ticketNumber, files);
        const mergedUrls = Array.from(new Set([...item.photoUrls, ...uploadedUrls]));
        const savedDescription = await persistTicketPhotoUrls(item, mergedUrls);

        if (selectedItem?.id === item.id) {
          setSelectedPhotoUrl(uploadedUrls[0] || selectedPhotoUrl);
          setSelectedItem((prev) =>
            prev && prev.id === item.id
              ? {
                  ...prev,
                  rawDescription: savedDescription,
                  photoUrls: mergedUrls,
                }
              : prev,
          );
        }

        setItems((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  rawDescription: savedDescription,
                  photoUrls: mergedUrls,
                }
              : entry,
          ),
        );

        showToast(`${uploadedUrls.length} photo(s) updated for ${item.ticketNumber}`, 'success');
      } catch (err: unknown) {
        console.error('Quick photo update failed:', err);
        showToast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        setUpdatingId(null);
      }
    };
    input.click();
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const searchStr = searchTerm.toLowerCase();
      const matchesSearch = 
        item.category?.toLowerCase().includes(searchStr) ||
        item.ticketNumber?.toLowerCase().includes(searchStr) ||
        item.customerName?.toLowerCase().includes(searchStr) ||
        item.name?.toLowerCase().includes(searchStr);
      
      const matchesStatus = filterStatus === 'all' || item.status === filterStatus;

      return matchesSearch && matchesStatus;
    });
  }, [items, searchTerm, filterStatus]);

  const stats = useMemo(() => ({
    total: items.length,
    inVault: items.filter(i => i.status === 'ACTIVE').length,
    redeemed: items.filter(i => i.status === 'REDEEMED').length,
    forAuction: items.filter(i => i.status === 'AUCTION').length,
    vaultValue: items
      .filter(i => i.status === 'ACTIVE')
      .reduce((sum, i) => sum + (Number(i.estimatedValue) || 0), 0)
  }), [items]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 font-inter text-left">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tight uppercase italic leading-none">
            Vault <span className="text-[#C9A05C]">Inventory</span>
          </h2>
          <div className="text-[#6B655C] font-bold text-[10px] uppercase tracking-widest mt-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#C9A05C]/100 animate-pulse" />
            Branch Secured: {activePawnshopId ? activePawnshopId.slice(0, 8) : '--------'}
          </div>
        </div>
        <button 
          onClick={fetchInventory}
          className="flex items-center gap-2 bg-[#14141B] text-[#EAE2D6] px-5 py-3 rounded-2xl border border-[rgba(201,160,92,0.12)] shadow-sm hover:bg-[#1C1C26] transition-all active:scale-95"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4 text-[#C9A05C]" />}
          <span className="text-[10px] font-black uppercase tracking-widest">Refresh Vault</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Items', val: stats.total, color: 'text-[#999186]' },
          { label: 'In Vault', val: stats.inVault, color: 'text-[#C9A05C]' },
          { label: 'Redeemed', val: stats.redeemed, color: 'text-emerald-600' },
          { label: 'In Auction', val: stats.forAuction, color: 'text-purple-600' },
          { label: 'Vault Value', val: formatTotalValue(stats.vaultValue), color: 'text-[#EAE2D6]' },
        ].map((s, i) => (
          <div key={i} className="bg-[#14141B] p-5 rounded-[2rem] border border-[rgba(201,160,92,0.08)] shadow-sm">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1 text-[#6B655C]">{s.label}</p>
            <p className={`text-xl font-black ${s.color}`}>{s.val}</p>
          </div>
        ))}
      </div>

      <div className="bg-[#14141B] rounded-[2.5rem] p-4 shadow-sm border border-[rgba(201,160,92,0.08)] flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="w-5 h-5 text-slate-300 absolute left-6 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search assets, customers, or ticket IDs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-14 pr-6 py-4 rounded-2xl border-none bg-[#1C1C26] text-sm font-bold placeholder:text-[#6B655C] focus:ring-2 focus:ring-blue-500/20 transition-all"
          />
        </div>
        
        <div className="relative group">
          <Filter className="w-4 h-4 text-blue-500 absolute left-5 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="appearance-none pl-12 pr-12 py-4 rounded-2xl bg-[#1C1C26] border-none text-[11px] font-black uppercase tracking-[0.15em] text-[#6B655C] cursor-pointer focus:ring-2 focus:ring-blue-500/20 transition-all w-full md:w-56"
          >
            <option value="all">Status: All Assets</option>
            <option value="ACTIVE">Status: In Vault</option>
            <option value="REDEEMED">Status: Redeemed</option>
            <option value="AUCTION">Status: Auction</option>
          </select>
          <ChevronDown className="w-4 h-4 text-[#6B655C] absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-32 bg-[#14141B] rounded-[3rem] border border-dashed border-[rgba(201,160,92,0.12)]">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
          <p className="text-[#6B655C] font-black uppercase tracking-widest text-[10px]">Accessing Vault Records...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 pb-20">
          {filteredItems.map((item) => (
            <div 
              key={item.id} 
              className={`group bg-[#14141B] rounded-[2.8rem] border border-[rgba(201,160,92,0.08)] p-3 shadow-sm hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-500 ${item.status === 'REDEEMED' ? 'opacity-75' : ''}`}
            >
              <div className="h-44 rounded-[2.2rem] bg-[#1C1C26] flex items-center justify-center relative overflow-hidden">
                {item.photoUrls.length > 0 ? (
                  <img
                    src={item.photoUrls[cardPhotoIndexes[item.id] || 0]}
                    alt={`${item.ticketNumber} photo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package className={`w-16 h-16 transition-transform duration-700 ${item.status === 'REDEEMED' ? 'text-emerald-100' : 'text-slate-200 group-hover:scale-110'}`} />
                )}
                {item.photoUrls.length > 1 ? (
                  <>
                    <button
                      onClick={() =>
                        setCardPhotoIndexes((prev) => {
                          const current = prev[item.id] || 0;
                          const next = current === 0 ? item.photoUrls.length - 1 : current - 1;
                          return { ...prev, [item.id]: next };
                        })
                      }
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-white/40 bg-black/40 text-white flex items-center justify-center"
                      aria-label="Previous photo"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() =>
                        setCardPhotoIndexes((prev) => {
                          const current = prev[item.id] || 0;
                          const next = current >= item.photoUrls.length - 1 ? 0 : current + 1;
                          return { ...prev, [item.id]: next };
                        })
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-white/40 bg-black/40 text-white flex items-center justify-center"
                      aria-label="Next photo"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                ) : null}
                <div className="absolute top-5 left-5">
                  {getStatusBadge(item.status)}
                </div>
                <div className="absolute bottom-5 right-5 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white shadow-sm">
                    <p className="text-[9px] font-black text-[#C9A05C] uppercase tracking-widest">{item.category}</p>
                </div>
              </div>

              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="font-black text-[#EAE2D6] text-lg leading-tight mb-1 truncate max-w-[180px]">{item.name}</h4>
                    <span className="text-[9px] font-black text-blue-500 bg-[#C9A05C]/10 px-2 py-0.5 rounded uppercase tracking-tighter">REF: {item.ticketNumber}</span>
                  </div>
                  <div className="flex flex-col items-end">
                     <p className="text-[8px] font-black text-slate-300 uppercase">Location</p>
                     <p className="text-[10px] font-bold text-[#6B655C]">{item.location}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Weight className="w-3 h-3 text-[#6B655C]" />
                      <span className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">Weight</span>
                    </div>
                    <p className="text-sm font-bold text-[#EAE2D6]">{item.weight}g</p>
                  </div>
                  <div className="bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Calendar className="w-3 h-3 text-[#6B655C]" />
                      <span className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">Pawned</span>
                    </div>
                    <p className="text-sm font-bold text-[#EAE2D6]">{new Date(item.pawnDate).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-5 border-t border-slate-50">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest mb-0.5">Customer</span>
                    <span className="text-xs font-bold text-[#EAE2D6] truncate max-w-[110px]">{item.customerName}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest block mb-0.5">Principal</span>
                    <span className="text-lg font-black text-[#EAE2D6] leading-none">{formatCurrency(Number(item.estimatedValue))}</span>
                  </div>
                </div>

                <div className="pt-4">
                  <div className={`grid gap-3 ${item.status === 'REDEEMED' ? 'grid-cols-4' : item.contractId ? 'grid-cols-4' : 'grid-cols-3'}`}>
                    <button
                      onClick={() => handleQuickPhotoChange(item)}
                      disabled={updatingId === item.id}
                      className="w-full text-[10px] font-black uppercase tracking-widest rounded-2xl px-3 py-3 border border-[rgba(201,160,92,0.12)] transition-all flex items-center justify-center gap-2 bg-[#14141B] text-[#999186] hover:bg-[#1C1C26] hover:text-[#EAE2D6] disabled:opacity-50"
                    >
                      {updatingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Change Photo'}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedItem(item);
                        setModalPhotoIndex(0);
                      }}
                      className="w-full text-[10px] font-black uppercase tracking-widest rounded-2xl px-4 py-3 border border-[rgba(201,160,92,0.12)] transition-all flex items-center justify-center gap-2 bg-[#14141B] text-[#999186] hover:bg-[#1C1C26] hover:text-[#EAE2D6]"
                    >
                      <Eye className="w-4 h-4" />
                      See Details
                    </button>
                    {item.contractId ? (
                      <button
                        onClick={() => handleShowContract(item)}
                        className="w-full text-[10px] font-black uppercase tracking-widest rounded-2xl px-4 py-3 border border-[rgba(201,160,92,0.12)] transition-all flex items-center justify-center gap-2 bg-[#14141B] text-[#C9A05C] hover:bg-[#1C1C26] hover:text-[#EAE2D6]"
                      >
                        Contract
                      </button>
                    ) : null}
                    {item.status === 'REDEEMED' ? (
                      <button
                        onClick={() => { setReceiptTicketId(item.id); setShowReceipt(true); }}
                        className="w-full text-[10px] font-black uppercase tracking-widest rounded-2xl px-4 py-3 border border-[rgba(201,160,92,0.12)] transition-all flex items-center justify-center gap-2 bg-[#14141B] text-[#C9A05C] hover:bg-[#1C1C26] hover:text-[#EAE2D6]"
                      >
                        <Receipt className="w-4 h-4" />
                        Receipt
                      </button>
                    ) : (
                      <button
                        onClick={() => handleMarkForAuction(item)}
                        disabled={item.status !== 'ACTIVE' || updatingId === item.id}
                        className="w-full text-[10px] font-black uppercase tracking-widest rounded-2xl px-4 py-3 border transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed bg-slate-900 text-white hover:bg-slate-800"
                      >
                        {updatingId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          'Mark for Auction'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && filteredItems.length === 0 && (
        <div className="text-center py-32 bg-[#1C1C26]/50 rounded-[3rem] border-2 border-dashed border-[rgba(201,160,92,0.08)]">
          <div className="bg-[#14141B] w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 border border-[rgba(201,160,92,0.08)] shadow-sm">
            <Package className="w-8 h-8 text-slate-200" />
          </div>
          <h3 className="text-[#EAE2D6] font-black text-xl italic tracking-tight">No Assets Found</h3>
          <p className="text-[#6B655C] text-sm font-medium mt-1">Check your connection or adjust filters.</p>
        </div>
      )}

      {selectedItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#14141B] rounded-[2rem] border border-[rgba(201,160,92,0.08)] shadow-2xl p-6 md:p-8 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Vault Item Details</p>
                <h3 className="text-2xl font-black text-[#EAE2D6] leading-tight">{selectedItem.name}</h3>
                <p className="text-xs font-bold text-[#C9A05C] mt-1">{selectedItem.ticketNumber}</p>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="h-10 w-10 rounded-xl border border-[rgba(201,160,92,0.12)] text-[#6B655C] hover:bg-[#1C1C26] flex items-center justify-center"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4 md:col-span-2">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-3">Item Photo</p>
                <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 items-start">
                  <div className="h-40 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] overflow-hidden flex items-center justify-center">
                    {selectedPhotoUrl ? (
                      <img src={selectedPhotoUrl} alt={`${selectedItem.ticketNumber} item`} className="h-full w-full object-cover" />
                    ) : (
                      <Package className="w-10 h-10 text-slate-300" />
                    )}
                  </div>
                  {selectedItem.photoUrls.length > 1 ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setModalPhotoIndex((prev) =>
                            prev === 0 ? selectedItem.photoUrls.length - 1 : prev - 1,
                          )
                        }
                        className="h-8 w-8 rounded-full border border-[rgba(201,160,92,0.12)] text-[#6B655C] flex items-center justify-center"
                        aria-label="Previous photo"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() =>
                          setModalPhotoIndex((prev) =>
                            prev >= selectedItem.photoUrls.length - 1 ? 0 : prev + 1,
                          )
                        }
                        className="h-8 w-8 rounded-full border border-[rgba(201,160,92,0.12)] text-[#6B655C] flex items-center justify-center"
                        aria-label="Next photo"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest">
                        Photo {Math.min(modalPhotoIndex + 1, selectedItem.photoUrls.length)} / {selectedItem.photoUrls.length}
                      </p>
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => setSelectedPhotoFiles(Array.from(e.target.files || []))}
                      className="w-full px-4 py-3 rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] text-xs font-bold text-[#6B655C]"
                    />
                    <button
                      onClick={handleSavePhoto}
                      disabled={selectedPhotoFiles.length === 0 || isSavingPhoto}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-[11px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : `Save ${selectedPhotoFiles.length > 1 ? 'Photos' : 'Photo'}`}
                    </button>
                    <p className="text-[10px] font-bold text-[#6B655C] uppercase tracking-wide">
                      Recommended: clear, well-lit image for auction visibility.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Customer</p>
                <p className="font-bold text-[#EAE2D6]">{selectedItem.customerName}</p>
              </div>
              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Status</p>
                {getStatusBadge(selectedItem.status)}
              </div>
              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Pawn Date</p>
                <p className="font-bold text-[#EAE2D6]">{new Date(selectedItem.pawnDate).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Payment Deadline</p>
                <p className="font-bold text-[#EAE2D6]">{selectedItem.expiryDate ? new Date(selectedItem.expiryDate).toLocaleString() : 'Not set'}</p>
                <p className={`text-xs mt-1 ${getDeadlineTone(getDaysRemaining(selectedItem.expiryDate))}`}>
                  {selectedItem.expiryDate
                    ? (() => {
                        const remaining = getDaysRemaining(selectedItem.expiryDate);
                        if (remaining == null) return 'Deadline unavailable';
                        if (remaining < 0) return `Overdue by ${Math.abs(remaining)} day(s)`;
                        return `${remaining} day(s) remaining`;
                      })()
                    : 'No deadline'}
                </p>
              </div>
              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Forfeiture Date</p>
                <p className="font-bold text-[#EAE2D6]">{selectedItem.forfeitureDate ? new Date(selectedItem.forfeitureDate).toLocaleString() : 'Not set'}</p>
              </div>
              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Location</p>
                <p className="font-bold text-[#EAE2D6]">{selectedItem.location}</p>
              </div>
              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Principal</p>
                <p className="font-bold text-[#EAE2D6]">{formatTotalValue(selectedItem.estimatedValue)}</p>
              </div>
              <div className="rounded-2xl bg-[#1C1C26] border border-[rgba(201,160,92,0.08)] p-4">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Interest Rate</p>
                <p className="font-bold text-[#EAE2D6]">{selectedItem.interestRate}%</p>
                {selectedItem.isHighRisk && (
                  <p className="text-[10px] mt-1 font-black uppercase tracking-widest text-rose-600">High Risk</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showReceipt && receiptTicketId && (
        <ReceiptViewer
          referenceType="TICKET"
          referenceId={receiptTicketId}
          open={showReceipt}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </div>
  );
}