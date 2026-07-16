import { useState, useEffect, useMemo, useRef } from 'react';
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
  Send,
  AlertTriangle,
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

interface KycFormData {
  fullName: string;
  dateOfBirth: string;
  address: string;
  phoneNumber: string;
  idType: 'NATIONAL_ID' | 'PASSPORT' | 'DRIVERS_LICENSE' | 'SSS_ID' | 'PHILHEALTH_ID' | 'TIN_ID' | 'VOTERS_ID' | 'POSTAL_ID' | 'OTHER';
  idNumber: string;
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

  // Bidding state
  const [bidAmount, setBidAmount] = useState<string>('');
  const [bidLoading, setBidLoading] = useState(false);
  const [bidExtended, setBidExtended] = useState(false);

  // Rating state
  const [ratingSummary, setRatingSummary] = useState<RatingSummary | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [myRating, setMyRating] = useState(5);
  const [myComment, setMyComment] = useState('');
  const [myRatingType, setMyRatingType] = useState<'ITEM_QUALITY' | 'TRANSACTION_EXPERIENCE' | 'SELLER_RATING'>('ITEM_QUALITY');
  const [submitRatingLoading, setSubmitRatingLoading] = useState(false);

  // KYC state (web auction house)
  const [showKycModal, setShowKycModal] = useState(false);
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [liveSelfieFile, setLiveSelfieFile] = useState<File | null>(null);
  const [liveSelfiePreview, setLiveSelfiePreview] = useState<string | null>(null);
  const [liveSelfieCapturedAt, setLiveSelfieCapturedAt] = useState<string | null>(null);
  const [kycForm, setKycForm] = useState<KycFormData>({
    fullName: '',
    dateOfBirth: '',
    address: '',
    phoneNumber: '',
    idType: 'NATIONAL_ID',
    idNumber: '',
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [webKycStatus, setWebKycStatus] = useState<'UNKNOWN' | 'VERIFIED' | 'PENDING' | 'REJECTED' | 'NOT_SUBMITTED'>('UNKNOWN');

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
    setBidAmount('');
    setBidExtended(false);
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
      // Set default bid amount to next minimum
      const nextMin = (data.currentBid || data.startingPrice) + (data.minBidIncrement || 100);
      setBidAmount(String(nextMin));
      // Fetch ratings for this listing
      fetchRatings(data.id);
      fetchBidLeaderboard(data.id);
      fetchProofTrail(data.id);
    } catch {
      setSelectedListing(listing);
      const nextMin = (listing.currentBid || listing.startingPrice) + (listing.minBidIncrement || 100);
      setBidAmount(String(nextMin));
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

  const extractKycStatus = (raw: any): 'VERIFIED' | 'PENDING' | 'REJECTED' | 'NOT_SUBMITTED' => {
    const candidates = [
      raw?.kycStatus,
      raw?.data?.kycStatus,
      raw?.data?.data?.kycStatus,
      raw?.kyc?.status,
      raw?.data?.kyc?.status,
      raw?.data?.data?.kyc?.status,
    ];
    const found = candidates.find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
    const normalized = (found || 'NOT_SUBMITTED').toUpperCase();
    if (normalized === 'VERIFIED') return 'VERIFIED';
    if (normalized === 'PENDING') return 'PENDING';
    if (normalized === 'REJECTED') return 'REJECTED';
    return 'NOT_SUBMITTED';
  };

  const loadWebKycStatus = async (): Promise<'VERIFIED' | 'PENDING' | 'REJECTED' | 'NOT_SUBMITTED' | 'UNKNOWN'> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setWebKycStatus('UNKNOWN');
        return 'UNKNOWN';
      }

      const res = await fetch(`${backendUrl}/auth/kyc/status`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        setWebKycStatus('UNKNOWN');
        return 'UNKNOWN';
      }

      const raw = await res.json();
      const status = extractKycStatus(raw);
      setWebKycStatus(status);
      return status;
    } catch {
      setWebKycStatus('UNKNOWN');
      return 'UNKNOWN';
    }
  };

  useEffect(() => {
    loadWebKycStatus();
  }, []);

  const stopLiveCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopLiveCamera();
      if (liveSelfiePreview) {
        URL.revokeObjectURL(liveSelfiePreview);
      }
    };
  }, [liveSelfiePreview]);

  const openKycModal = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const fullName = (session?.user?.user_metadata?.fullName || session?.user?.user_metadata?.full_name || '').toString();
    setKycForm((prev) => ({ ...prev, fullName: prev.fullName || fullName }));
    setShowKycModal(true);
  };

  const startLiveCamera = async () => {
    setCameraLoading(true);
    try {
      stopLiveCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      showToast('Unable to access camera. Please allow camera permission.', 'error');
    } finally {
      setCameraLoading(false);
    }
  };

  const captureLiveSelfie = async () => {
    if (!videoRef.current || !canvasRef.current) {
      showToast('Camera is not ready', 'error');
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const width = video.videoWidth || 720;
    const height = video.videoHeight || 1280;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      showToast('Failed to capture selfie', 'error');
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) {
      showToast('Failed to capture selfie', 'error');
      return;
    }

    const file = new File([blob], `live-selfie-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });

    if (liveSelfiePreview) {
      URL.revokeObjectURL(liveSelfiePreview);
    }

    setLiveSelfieFile(file);
    setLiveSelfiePreview(URL.createObjectURL(file));
    setLiveSelfieCapturedAt(new Date().toISOString());
    showToast('Live selfie captured', 'success');
  };

  const uploadKycFile = async (file: File, folder: string, userId: string) => {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const safeExt = (ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${folder}/${userId}_${Date.now()}.${safeExt}`;

    const { error } = await supabase.storage
      .from('kyc-documents')
      .upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      throw new Error(error.message || 'Failed to upload KYC file');
    }

    const { data } = supabase.storage.from('kyc-documents').getPublicUrl(path);
    return data.publicUrl;
  };

  const submitWebKyc = async () => {
    if (!kycForm.fullName || !kycForm.dateOfBirth || !kycForm.address || !kycForm.phoneNumber || !kycForm.idNumber) {
      showToast('Please complete all required fields', 'error');
      return;
    }
    if (!idFrontFile) {
      showToast('Please upload the front of your ID', 'error');
      return;
    }
    if (!liveSelfieFile || !liveSelfieCapturedAt) {
      showToast('Please capture a live selfie using camera', 'error');
      return;
    }

    setKycSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !session?.user?.id) {
        showToast('Please sign in again', 'error');
        return;
      }

      const idFrontUrl = await uploadKycFile(idFrontFile, 'id-front', session.user.id);
      const idBackUrl = idBackFile
        ? await uploadKycFile(idBackFile, 'id-back', session.user.id)
        : null;
      const selfieUrl = await uploadKycFile(liveSelfieFile, 'selfie', session.user.id);

      const res = await fetch(`${backendUrl}/auth/kyc/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          fullName: kycForm.fullName.trim(),
          dateOfBirth: kycForm.dateOfBirth,
          address: kycForm.address.trim(),
          phoneNumber: kycForm.phoneNumber.trim(),
          idType: kycForm.idType,
          idNumber: kycForm.idNumber.trim(),
          idFrontUrl,
          idBackUrl,
          selfieUrl,
          liveSelfieUrl: selfieUrl,
          selfieCaptureMode: 'LIVE',
          selfieCapturedAt: liveSelfieCapturedAt,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || 'KYC submission failed');
      }

      showToast('KYC submitted. Please wait for admin approval.', 'success');
      stopLiveCamera();
      setShowKycModal(false);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err) || 'KYC submission failed', 'error');
    } finally {
      setKycSubmitting(false);
    }
  };

  const handlePlaceBid = async () => {
    if (!selectedListing) return;
    const amount = parseFloat(bidAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast('Put Valid Amount', 'error');
      return;
    }

    const nextMin = (selectedListing.currentBid || selectedListing.startingPrice) + (selectedListing.minBidIncrement || 100);
    if (amount < nextMin) {
      showToast('Put Valid Amount', 'error');
      return;
    }

    setBidLoading(true);
    setBidExtended(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showToast('Please sign in to place a bid', 'error');
        return;
      }

      const kycStatus = await loadWebKycStatus();

      if (kycStatus !== 'VERIFIED') {
        if (kycStatus === 'PENDING') {
          showToast('Your KYC is under review. Bidding is enabled after approval.', 'error');
        } else {
          showToast('Complete KYC verification with live selfie before bidding.', 'error');
          await openKycModal();
        }
        return;
      }

      const res = await fetch(`${backendUrl}/auction/listings/${selectedListing.id}/bids`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amount }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = String(err?.message || 'Failed to place bid');
        if (message.toLowerCase().includes('valid amount')) {
          throw new Error('Put Valid Amount');
        }
        throw new Error(message);
      }

      const rawResult = await res.json();
      const result = rawResult?.data ?? rawResult;

      // Update selected listing with new bid data
      setSelectedListing(prev => prev ? {
        ...prev,
        currentBid: amount,
        bidCount: (prev.bidCount || 0) + 1,
        endAt: result.endAt || prev.endAt,
      } : prev);

      // Also update in listings array
      setListings(prev => prev.map(l => l.id === selectedListing.id ? {
        ...l,
        currentBid: amount,
        bidCount: (l.bidCount || 0) + 1,
        endAt: result.endAt || l.endAt,
      } : l));

      if (result.extended) {
        setBidExtended(true);
        showToast(`Bid placed! Timer extended by ${selectedListing.bidExtensionMin || 5} minutes (anti-sniping)`, 'success');
      } else {
        showToast('Bid placed successfully!', 'success');
      }

      fetchBidLeaderboard(selectedListing.id);

      // Update bid amount to next minimum
      const newNextMin = amount + (selectedListing.minBidIncrement || 100);
      setBidAmount(String(newNextMin));
    } catch (err: unknown) {
      const msg = String(err instanceof Error ? err.message : String(err) || 'Failed to place bid');
      if (msg.toLowerCase().includes('verification') || msg.toLowerCase().includes('kyc')) {
        await openKycModal();
      }
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to place bid', 'error');
    } finally {
      setBidLoading(false);
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

  const kycBadge = (() => {
    if (webKycStatus === 'VERIFIED') return { text: 'BIDDER KYC VERIFIED', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (webKycStatus === 'PENDING') return { text: 'BIDDER KYC PENDING', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    if (webKycStatus === 'REJECTED') return { text: 'BIDDER KYC REJECTED', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
    if (webKycStatus === 'NOT_SUBMITTED') return { text: 'BIDDER KYC NOT SUBMITTED', cls: 'bg-[#1C1C26] text-[#6B655C] border-[rgba(201,160,92,0.12)]' };
    return { text: 'BIDDER KYC UNKNOWN', cls: 'bg-[#1C1C26] text-[#6B655C] border-[rgba(201,160,92,0.12)]' };
  })();

  const kycModal = showKycModal ? (
    <div className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-[#14141B] rounded-[2rem] border border-[rgba(201,160,92,0.12)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(201,160,92,0.08)]">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Auction House KYC</p>
            <h3 className="text-xl font-black text-[#EAE2D6]">Verify Identity With Live Selfie</h3>
          </div>
          <button
            onClick={() => {
              stopLiveCamera();
              setShowKycModal(false);
            }}
            className="text-[#6B655C] hover:text-[#6B655C] text-sm font-black"
          >
            CLOSE
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 max-h-[78vh] overflow-y-auto">
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Personal Details</p>
            <input
              value={kycForm.fullName}
              onChange={(e) => setKycForm((prev) => ({ ...prev, fullName: e.target.value }))}
              placeholder="Full legal name"
              className="w-full rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm font-medium"
            />
            <input
              type="date"
              value={kycForm.dateOfBirth}
              onChange={(e) => setKycForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
              className="w-full rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm font-medium"
            />
            <input
              value={kycForm.address}
              onChange={(e) => setKycForm((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="Address"
              className="w-full rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm font-medium"
            />
            <input
              value={kycForm.phoneNumber}
              onChange={(e) => setKycForm((prev) => ({ ...prev, phoneNumber: e.target.value }))}
              placeholder="Phone number"
              className="w-full rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm font-medium"
            />
            <select
              value={kycForm.idType}
              onChange={(e) => setKycForm((prev) => ({ ...prev, idType: e.target.value as KycFormData['idType'] }))}
              className="w-full rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm font-bold text-[#6B655C]"
            >
              <option value="NATIONAL_ID">National ID</option>
              <option value="PASSPORT">Passport</option>
              <option value="DRIVERS_LICENSE">Driver's License</option>
              <option value="SSS_ID">SSS ID</option>
              <option value="PHILHEALTH_ID">PhilHealth ID</option>
              <option value="TIN_ID">TIN ID</option>
              <option value="VOTERS_ID">Voter's ID</option>
              <option value="POSTAL_ID">Postal ID</option>
              <option value="OTHER">Other</option>
            </select>
            <input
              value={kycForm.idNumber}
              onChange={(e) => setKycForm((prev) => ({ ...prev, idNumber: e.target.value }))}
              placeholder="ID number"
              className="w-full rounded-xl border border-[rgba(201,160,92,0.12)] px-3 py-2 text-sm font-medium"
            />

            <div className="pt-2 space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#6B655C]">ID Front (required)</label>
              <input type="file" accept="image/*" onChange={(e) => setIdFrontFile(e.target.files?.[0] || null)} className="w-full text-xs" />
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#6B655C]">ID Back (optional)</label>
              <input type="file" accept="image/*" onChange={(e) => setIdBackFile(e.target.files?.[0] || null)} className="w-full text-xs" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Live Selfie Capture</p>
              <button
                onClick={startLiveCamera}
                disabled={cameraLoading}
                className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 disabled:opacity-60"
              >
                {cameraLoading ? 'Starting...' : 'Start Camera'}
              </button>
            </div>

            <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-[rgba(201,160,92,0.12)] bg-[#1C1C26]">
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              <div className="absolute inset-4 border-2 border-amber-400/70 rounded-[1.5rem] pointer-events-none" />
            </div>

            <button
              onClick={captureLiveSelfie}
              className="w-full px-3 py-3 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700"
            >
              Capture Live Selfie
            </button>

            {liveSelfiePreview && (
              <div className="rounded-2xl overflow-hidden border border-emerald-200">
                <img src={liveSelfiePreview} alt="Live selfie" className="w-full h-40 object-cover" />
              </div>
            )}

            <p className="text-[10px] text-[#6B655C] font-bold">
              Use your device camera now. Gallery selfies are not accepted.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[rgba(201,160,92,0.08)] flex items-center justify-end gap-3">
          <button
            onClick={() => {
              stopLiveCamera();
              setShowKycModal(false);
            }}
            className="px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.12)] text-[#999186] text-[10px] font-black uppercase tracking-widest"
          >
            Cancel
          </button>
          <button
            onClick={submitWebKyc}
            disabled={kycSubmitting}
            className="px-5 py-2 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 disabled:opacity-60 flex items-center gap-2"
          >
            {kycSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Submit KYC
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  ) : null;

  // ==================== DETAIL VIEW ====================
  if (selectedListing) {
    const countdown = formatCountdown(selectedListing.endAt, now);
    const imageUrl = selectedListing.images?.[0]?.url;

    return (
      <>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <button
          onClick={() => setSelectedListing(null)}
          className="flex items-center gap-2 text-sm font-bold text-[#6B655C] hover:text-[#EAE2D6] transition-colors"
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
                <h2 className="text-2xl font-black text-[#EAE2D6] mt-1 leading-tight">{selectedListing.title}</h2>
                <p className="text-sm text-[#6B655C] mt-2">#{selectedListing.ticket.ticketNumber}</p>
              </div>

              <p className="text-sm text-[#999186] leading-relaxed">
                {selectedListing.description || selectedListing.ticket.description || 'No description available.'}
              </p>

              <div className="grid grid-cols-2 gap-4 py-6 border-y border-[rgba(201,160,92,0.08)]">
                <div>
                  <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Current Bid</p>
                  <p className="text-2xl font-black text-[#C9A05C]">{formatCurrency(selectedListing.currentBid || selectedListing.startingPrice)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest mb-1">Starting Price</p>
                  <p className="text-2xl font-black text-[#EAE2D6]">{formatCurrency(selectedListing.startingPrice)}</p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest">{countdown.label}</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { val: countdown.hours, label: 'Hours' },
                    { val: countdown.minutes, label: 'Min' },
                    { val: countdown.seconds, label: 'Sec' },
                  ].map((t) => (
                    <div key={t.label} className={`text-center p-3 rounded-2xl border ${countdown.urgent ? 'bg-rose-50 border-rose-200' : 'bg-[#1C1C26] border-[rgba(201,160,92,0.08)]'}`}>
                      <p className={`text-2xl font-black ${countdown.urgent ? 'text-rose-600' : 'text-[#EAE2D6]'}`}>{t.val}</p>
                      <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">{t.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-1 text-center bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                  <p className="text-lg font-black text-[#EAE2D6]">{selectedListing.bidCount}</p>
                  <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">Bids</p>
                </div>
                <div className="flex-1 text-center bg-[#1C1C26] p-3 rounded-2xl border border-[rgba(201,160,92,0.08)]">
                  <p className="text-lg font-black text-[#EAE2D6]">{selectedListing.ticket.category || 'General'}</p>
                  <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">Category</p>
                </div>
              </div>

              <div className="space-y-3 border border-[rgba(201,160,92,0.08)] rounded-2xl p-4 bg-[#1C1C26]/70">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Top Bidder Leaderboard</p>
                  {bidLeaderboard?.totalBidders ? (
                    <p className="text-[10px] font-bold text-[#6B655C]">{bidLeaderboard.totalBidders} bidder(s)</p>
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
                          <p className="text-xs font-black text-[#6B655C] truncate">#{entry.rank} {entry.bidderName}</p>
                          <p className="text-[10px] text-[#6B655C] truncate">{entry.bidderEmail || entry.bidderId}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-[#C9A05C]">{formatCurrency(entry.highestBid)}</p>
                          <p className="text-[10px] text-[#6B655C]">{entry.totalBids} bid{entry.totalBids !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#6B655C]">No bids yet for this listing.</p>
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
                  <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Private Proof Trail</p>
                  <p className="text-[10px] font-bold text-[#6B655C]">Visible to authenticated staff only</p>
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
                            <p className="text-xs font-black text-[#6B655C] truncate">{proof.title}</p>
                            <p className="text-[10px] text-[#6B655C] uppercase tracking-widest">{proof.recordType}</p>
                          </div>
                          <p className="text-[10px] font-bold text-[#6B655C] truncate">{proof.proofNumber}</p>
                        </div>
                        <p className="text-xs text-[#999186] mt-1">{proof.summary}</p>
                        <div className="flex items-center justify-between mt-2 text-[10px] text-[#6B655C]">
                          <span>{proof.createdAt ? new Date(proof.createdAt).toLocaleString('en-PH') : 'Unknown time'}</span>
                          <span>{proof.sourceHash ? `${proof.sourceHash.slice(0, 12)}â€¦` : 'No hash'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#6B655C]">No private proof trail is available for this listing yet.</p>
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
                  <p className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest">Ratings & Feedback</p>
                </div>
                {ratingSummary && ratingSummary.totalRatings > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-lg font-black text-amber-600">{ratingSummary.averageRating}</span>
                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                    <span className="text-xs text-[#6B655C] font-bold">({ratingSummary.totalRatings})</span>
                  </div>
                )}
              </div>

              {/* Submit Rating (only for ENDED auctions) */}
              {(selectedListing.status === 'ENDED' || selectedListing.status === 'CANCELLED') && (
                <div className="space-y-3 p-4 bg-[#1C1C26] rounded-2xl">
                  <p className="text-xs font-bold text-[#999186]">Leave your rating</p>
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
                    className="w-full rounded-xl px-3 py-2 border border-[rgba(201,160,92,0.12)] text-sm font-bold text-[#6B655C]"
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
                    className="w-full rounded-xl px-3 py-2 border border-[rgba(201,160,92,0.12)] text-sm text-[#6B655C] resize-none focus:border-amber-300 focus:ring-0 transition-all"
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
                          <p className="text-xs font-bold text-[#6B655C]">{r.customer.fullName}</p>
                          <span className="text-[9px] font-bold text-[#6B655C] uppercase">
                            {r.ratingType.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5 mt-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} className={`w-3 h-3 ${s <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
                          ))}
                        </div>
                        {r.comment && <p className="text-xs text-[#6B655C] mt-1">{r.comment}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#6B655C] text-center py-4">No ratings yet.</p>
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
      {kycModal}
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
          <h1 className="text-3xl font-black text-[#EAE2D6] flex items-center gap-3 tracking-tight">
            <div className="p-2 bg-amber-500 rounded-xl shadow-lg shadow-amber-200">
              <Gavel className="w-6 h-6 text-white" />
            </div>
            Live Auctions
          </h1>
          <p className="text-[#6B655C] font-medium mt-1">
            Browse live auction listings from your pawnshop network.
          </p>
          <div className="mt-3 inline-flex items-center rounded-full border border-[rgba(201,160,92,0.12)] bg-[#1C1C26] px-3 py-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#6B655C]">
              View Only for Pawnshop Team
            </span>
          </div>
        </div>

        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6B655C] group-focus-within:text-amber-500 transition-colors" />
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
            <p className="text-[#6B655C] text-[10px] font-black uppercase tracking-widest">Live Listings</p>
          </div>
          <p className="text-3xl font-black text-[#EAE2D6]">{liveCount}</p>
        </div>

        <div className="bg-[#14141B] border border-[rgba(201,160,92,0.08)] p-6 rounded-[2rem] shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><TrendingUp className="w-4 h-4" /></div>
            <p className="text-[#6B655C] text-[10px] font-black uppercase tracking-widest">Total Bid Value</p>
          </div>
          <p className="text-3xl font-black text-[#EAE2D6]">{formatCurrency(totalValue)}</p>
        </div>

        <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl shadow-slate-200">
          <div className="flex justify-between items-start mb-4">
            <p className="text-[#6B655C] text-[10px] font-black uppercase tracking-widest">Total Bids</p>
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
                : 'bg-[#14141B] border border-[rgba(201,160,92,0.12)] text-[#999186] hover:bg-[#1C1C26]'
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
                  : 'bg-[#14141B] border border-[rgba(201,160,92,0.12)] text-[#999186] hover:bg-[#1C1C26]'
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
          <p className="text-[#6B655C] text-[10px] font-black uppercase mt-4 tracking-widest">Loading live auctions...</p>
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
                      <span className="px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full text-[10px] font-black text-[#6B655C]">
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
                        <span className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest flex items-center gap-1">
                          <Tag className="w-3 h-3" /> {cat}
                        </span>
                      </div>
                      <h3 className="text-lg font-black text-[#EAE2D6] leading-tight group-hover:text-amber-600 transition-colors">
                        {listing.title}
                      </h3>
                      <p className="text-xs text-[#6B655C] mt-1">#{listing.ticket?.ticketNumber || 'N/A'}</p>
                    </div>

                    <div className="flex items-baseline justify-between mt-auto">
                      <div>
                        <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest">Current Bid</p>
                        <p className="text-xl font-black text-[#C9A05C]">{formatCurrency(listing.currentBid || listing.startingPrice)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black text-[#6B655C] uppercase tracking-widest flex items-center gap-1 justify-end">
                          <Clock className="w-3 h-3" /> {countdown.label}
                        </p>
                        <p className={`text-sm font-black ${countdown.urgent ? 'text-rose-600' : 'text-[#EAE2D6]'}`}>
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
              <p className="text-[#6B655C] font-bold text-[10px] uppercase tracking-widest">
                {search || categoryFilter !== 'all'
                  ? 'No listings match your filters.'
                  : 'No live auctions at this time.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
    {kycModal}
    </>
  );
}
