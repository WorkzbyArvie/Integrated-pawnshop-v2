import { useRef, useState, useEffect, useCallback } from 'react';
import { 
  Calculator, 
  Scale, 
  Building2, 
  AlertCircle, 
  Loader2, 
  MapPin, 
  Phone, 
  User,
  AlertTriangle 
} from 'lucide-react';
import { useToast } from '../App';
import { supabase } from '../lib/supabaseClient';
import api from '../lib/apiClient';
import { formatCurrency } from '../lib/formatters';

// Interface matches the props passed from App.tsx
interface SalesPosProps {
  branchId: string | null;
  activeBranchId?: number | null;
  setActiveTab: (tab: string) => void;
}

/**
 * A valuation, priced by `POST /appraisal/quote`.
 *
 * The rates come back with the figure so the appraisal is reproducible after the
 * fact — a per-gram constant that changes later must not silently change what a
 * past ticket was worth.
 */
interface AppraisalQuote {
  itemCategory: string;
  collateralClass: string;
  weight: number;
  gramRate: number;
  ltvRatio: number;
  appraisedValue: number;
  recommendedLoanAmount: number;
  termDays: number;
  maturityDate: string;
  gracePeriodDays: number;
  gracePeriodEnds: string;
  risk: {
    score: number;
    band: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    factors: string[];
    blocking: boolean;
  };
  compliance: {
    statutoryMinLtv: number;
    belowStatutoryMinimum: boolean;
    note?: string;
  };
  ratesUsed: Record<string, number>;
}

export function SalesPos({ branchId, activeBranchId }: SalesPosProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const STORAGE_BUCKET_CANDIDATES = ['kyc-documents', 'loan-documents', 'loan-contracts'];
  const defaultDeadline = () => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  };

  const [formData, setFormData] = useState({
    customerName: '',
    customerAddress: '',
    customerContact: '',
    hasMobileAccount: false,
    accountEmail: '',
    itemCategory: '',
    itemDescription: '',
    weight: '',
    appraisalDeadline: defaultDeadline(),
    markForAuction: false,
  });

  const [riskScore, setRiskScore] = useState<number | null>(null);
  const [recommendedAmount, setRecommendedAmount] = useState<number | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  /** The server's figures behind the score, shown so the appraiser sees the basis. */
  const [quoteDetails, setQuoteDetails] = useState<AppraisalQuote | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [itemPhotoFiles, setItemPhotoFiles] = useState<File[]>([]);
  const [confirmData, setConfirmData] = useState<{
    ticketId: number;
    ticketNumber: string;
    loanAmount: number;
    category: string;
    weight: number;
    customerName: string;
    customerContact: string;
    customerAddress: string;
    riskScore: number | null;
    /** The server's band, so the confirmation shows the same verdict as the quote. */
    riskBand: string | null;
  } | null>(null);

  const [customerDuplicate, setCustomerDuplicate] = useState<{ checking: boolean; exists: boolean; message: string }>({
    checking: false,
    exists: false,
    message: '',
  });
  const customerCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkCustomerDuplicate = useCallback(async (name: string, contact: string) => {
    if (!name.trim() || !contact.trim()) {
      setCustomerDuplicate({ checking: false, exists: false, message: '' });
      return;
    }
    setCustomerDuplicate((prev) => ({ ...prev, checking: true }));
    try {
      // No pawnshopId is sent. The endpoint derives the tenant from the session
      // and refuses to search beyond the caller's own shop, which is exactly
      // what this call previously defeated by passing a branch id where a
      // tenant UUID was expected.
      const res = await api.get<{ exists: boolean; message: string }>('/customers/check', {
        fullName: name.trim(),
        contactNumber: contact.trim(),
      });
      setCustomerDuplicate({ checking: false, exists: res.exists, message: res.exists ? res.message : '' });
    } catch {
      setCustomerDuplicate({ checking: false, exists: false, message: '' });
    }
  }, []);

  useEffect(() => {
    if (customerCheckTimer.current) clearTimeout(customerCheckTimer.current);
    if (!formData.customerName.trim() || !formData.customerContact.trim()) {
      setCustomerDuplicate({ checking: false, exists: false, message: '' });
      return;
    }
    customerCheckTimer.current = setTimeout(() => {
      checkCustomerDuplicate(formData.customerName, formData.customerContact);
    }, 600);
    return () => {
      if (customerCheckTimer.current) clearTimeout(customerCheckTimer.current);
    };
  }, [formData.customerName, formData.customerContact, checkCustomerDuplicate]);

  const displayBranchName = branchId ? `Branch: ${String(branchId).slice(0, 8)}` : "PawnGold HQ";

  const itemCategories = [
    'Gold Jewelry',
    'Silver Jewelry',
    'Diamond Jewelry',
    'Gold Coins',
  ];

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

  const uploadAppraisalPhoto = async (ticketNumber: string, file: File, index: number) => {
    const path = `appraisal-items/${ticketNumber}-${index + 1}.jpg`;
    const optimized = await compressImage(file);

    for (const bucket of STORAGE_BUCKET_CANDIDATES) {
      const { error } = await supabase.storage.from(bucket).upload(path, optimized, {
        upsert: true,
        contentType: optimized.type || 'image/jpeg',
      });

      if (!error) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        return data.publicUrl;
      }

      const message = String((error as any)?.message || '').toLowerCase();
      if (!message.includes('bucket not found')) {
        throw error;
      }
    }

    throw new Error(
      `Storage bucket not found. Configure one of: ${STORAGE_BUCKET_CANDIDATES.join(', ')}`,
    );
  };

  /**
   * Price the item, on the server.
   *
   * This used to be a table in this file:
   *
   *   'Gold Jewelry':    { risk: (w) => w > 50  ? 12 : 22, rate: 3200 },
   *   'Silver Jewelry':  { risk: (w) => w > 100 ? 20 : 32, rate: 42   },
   *   const amount = weight * config.rate * 0.7;
   *
   * Three problems, all now server-side in `backend/src/loan/appraisal.ts`:
   * nothing recorded what produced the valuation, so a past ticket's worth was
   * not reproducible; the silver rate of PHP 42/gram is a pre-2020 figure, and
   * Philippine pawn loans run PHP 70-90, so every silver item was appraised at
   * about half its value; and the risk curve read `w > 100 ? 20 : 32`, scoring
   * a heavier item as *safer*, which is backwards on both credit and handling.
   *
   * The quote also returns the P.D. 114 Section 9 floor check and the risk
   * factors behind the score, so the appraiser can see why rather than being
   * handed a number.
   */
  const calculateRisk = async () => {
    const weight = parseFloat(formData.weight);
    if (isNaN(weight) || weight <= 0) {
      showToast("Please enter a valid weight/quantity.", "error");
      return;
    }
    if (!formData.itemCategory) {
      showToast("Please select an item category.", "error");
      return;
    }

    setIsQuoting(true);
    try {
      const priced = await api.post<AppraisalQuote>('/appraisal/quote', {
        itemCategory: formData.itemCategory,
        weight,
        // Not yet verified at this point in the flow - the appraiser inspects
        // the item, so the default is the honest answer and the score reflects
        // that the item has not been confirmed yet.
        authenticityVerified: false,
      });

      setRiskScore(priced.risk.score);
      setRecommendedAmount(priced.recommendedLoanAmount);
      setQuoteDetails(priced);

      if (priced.risk.blocking) {
        showToast(
          'This item cannot be pawned: it has been flagged as a suspected counterfeit.',
          'error',
        );
        setRiskScore(null);
        setRecommendedAmount(null);
        return;
      }

      if (priced.compliance?.belowStatutoryMinimum) {
        showToast(
          'Below the P.D. 114 s.9 minimum of 30% of appraised value — the pawner must sign a written request to borrow less.',
          'error',
        );
      }
    } catch (err: unknown) {
      showToast(
        `Could not price this item: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      setIsQuoting(false);
    }
  };

  const handleApprove = async () => {
    // `recommendedAmount` is now the server's figure rather than a local
    // calculation, so the ticket records the same valuation that was displayed
    // to the appraiser.
    if (!recommendedAmount) {
      showToast("Please calculate the loan amount first.", "error");
      return;
    }

    if (quoteDetails?.risk.blocking) {
      showToast(
        'This item was flagged as a suspected counterfeit and cannot be pawned.',
        'error',
      );
      return;
    }

    if (!branchId) {
      showToast("Critical Error: No Branch UUID detected.", "error");
      return;
    }

    if (!itemPhotoFiles.length) {
      showToast('At least one appraisal photo is required before submission.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const ticketNumber = `TKT-${Math.floor(Date.now() / 1000)}`;

      const uploadedPhotoUrls: string[] = [];
      for (let index = 0; index < itemPhotoFiles.length; index += 1) {
        const uploaded = await uploadAppraisalPhoto(ticketNumber, itemPhotoFiles[index], index);
        uploadedPhotoUrls.push(uploaded);
      }

      const result = await api.post<{
        id: number;
        ticketNumber: string;
        customerId: string;
        status: string;
        lifecycleStatus: string;
      }>('/pawn-tickets', {
        customerName: formData.customerName,
        customerAddress: formData.customerAddress,
        customerContact: formData.customerContact,
        accountEmail: formData.hasMobileAccount ? formData.accountEmail.trim() : undefined,
        itemCategory: formData.itemCategory,
        itemDescription: formData.itemDescription,
        weight: parseFloat(formData.weight),
        loanAmount: recommendedAmount,
        // The valuation, which is not the loan. Without it the ticket carries
        // only the loan, and `submitForApproval` writes that into both
        // `appraisedValue` and `recommendedLoanAmount` - so the approval record
        // shows one figure twice and the collateral has no recorded value.
        appraisedValue: quoteDetails?.appraisedValue,
        // `||` would turn a score of 0 into undefined. Zero is the score of a
        // fully-cleared item under the server's model, so it is a real value to
        // record, not an absence of one.
        riskScore: riskScore ?? undefined,
        photoUrls: uploadedPhotoUrls,
        appraisalDeadline: formData.appraisalDeadline,
        markForAuction: formData.markForAuction,
        pawnshopId: branchId,
        branchId: Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0
          ? Number(activeBranchId)
          : undefined,
      });

      setConfirmData({
        ticketId: result.id,
        ticketNumber: result.ticketNumber,
        loanAmount: recommendedAmount,
        category: formData.itemCategory,
        weight: parseFloat(formData.weight),
        customerName: formData.customerName,
        customerContact: formData.customerContact,
        customerAddress: formData.customerAddress,
        riskScore,
        riskBand: quoteDetails?.risk.band ?? null,
      });

    } catch (error: any) {
      console.error("Backend Error:", error);
      showToast(error.message || "Failed to save transaction", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      customerName: '',
      customerAddress: '',
      customerContact: '',
      hasMobileAccount: false,
      accountEmail: '',
      itemCategory: '',
      itemDescription: '',
      weight: '',
      appraisalDeadline: defaultDeadline(),
      markForAuction: false,
    });
    setRiskScore(null);
    setRecommendedAmount(null);
    setQuoteDetails(null);
    setItemPhotoFiles([]);
    setConfirmData(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmApproval = async () => {
    if (!confirmData) return;
    setIsConfirming(true);
    try {
      await api.post(`/pawn-tickets/${confirmData.ticketId}/submit-for-approval`, {});
      showToast(`Ticket ${confirmData.ticketNumber} submitted for manager approval!`, "success");
      resetForm();
    } catch (error: any) {
      console.error("Submit for approval error:", error);
      showToast(error.message || "Failed to submit for approval", "error");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleEdit = () => {
    setConfirmData(null);
  };

  /**
   * Colour a risk band.
   *
   * Keyed on the server's band rather than on a second set of score thresholds
   * here. The old version cut at 30 and 50 while the server cuts at 20, 40 and
   * 70, so a score of 55 rendered amber on this screen and CRITICAL on the
   * receipt — two different verdicts for the same pawn, and a panel member
   * comparing the two would be right to ask which one is authoritative.
   */
  const RISK_BAND_STYLE: Record<string, { color: string; bg: string }> = {
    LOW: { color: 'text-green-600', bg: 'bg-green-50' },
    MODERATE: { color: 'text-amber-600', bg: 'bg-amber-50' },
    HIGH: { color: 'text-orange-600', bg: 'bg-orange-50' },
    CRITICAL: { color: 'text-red-600', bg: 'bg-red-50' },
  };

  const getRiskStyle = (score: number) => {
    if (score < 30) return { color: 'text-green-600', bg: 'bg-green-50', label: 'Low Risk' };
    if (score < 50) return { color: 'text-amber-600', bg: 'bg-amber-50', label: 'Medium Risk' };
    return { color: 'text-red-600', bg: 'bg-red-50', label: 'High Risk' };
  };

  return (
    <div className="p-8 space-y-8 bg-[#1C1C26]/50 min-h-screen text-left animate-in fade-in duration-500">
      
      {!branchId && (
        <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex items-center gap-3 text-rose-600">
          <AlertCircle size={18} />
          <p className="text-xs font-bold uppercase tracking-tight">Warning: No Pawnshop context detected. Transactions disabled.</p>
        </div>
      )}

      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-black text-[#030213] uppercase italic tracking-tighter">
            Loan <span className="text-[#C9A05C]">Management</span>
          </h1>
          <p className="text-[#8A8279] text-xs font-bold flex items-center gap-2 uppercase tracking-wide">
            <Building2 size={14} className="text-[#C9A05C]" /> {displayBranchName}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="bg-[#14141B] rounded-[2.5rem] p-10 shadow-sm border-none">
            <div className="flex items-center gap-4 mb-10">
              <div className="w-14 h-14 bg-[#C9A05C]/10 text-[#C9A05C] rounded-2xl flex items-center justify-center">
                <Calculator className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-black text-[#F5F0E8] uppercase tracking-tight">New Appraisal Form</h3>
                <p className="text-[10px] text-[#8A8279] font-black uppercase tracking-widest">Enter item and customer details</p>
              </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); calculateRisk(); }} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label htmlFor="customerName" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Customer Name</label>
                  <div className="relative">
                    <input
                      id="customerName"
                      type="text"
                      value={formData.customerName}
                      onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                      className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8] pl-14"
                      placeholder="Enter customer name"
                      required
                    />
                    <User className="w-5 h-5 text-slate-300 absolute left-5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div className="space-y-3">
                  <label htmlFor="itemCategory" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Item Category</label>
                  <select
                    id="itemCategory"
                    value={formData.itemCategory}
                    onChange={(e) => setFormData({ ...formData, itemCategory: e.target.value })}
                    className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8] appearance-none"
                    required
                  >
                    <option value="">Select category</option>
                    {itemCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 p-5">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.hasMobileAccount}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        hasMobileAccount: e.target.checked,
                        accountEmail: e.target.checked ? formData.accountEmail : '',
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-[#C9A05C] focus:ring-[#C9A05C]"
                  />
                  <span className="text-[11px] font-bold text-[#8A8279] uppercase tracking-widest">
                    Customer has mobile account
                  </span>
                </label>

                {formData.hasMobileAccount && (
                  <div className="space-y-2">
                    <label htmlFor="accountEmail" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">
                      Account Email (optional)
                    </label>
                    <input
                      id="accountEmail"
                      type="email"
                      value={formData.accountEmail}
                      onChange={(e) => setFormData({ ...formData, accountEmail: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] focus:ring-2 focus:ring-[#C9A05C] outline-none font-bold text-[#F5F0E8]"
                      placeholder="bidder@email.com"
                    />
                    <p className="text-[10px] text-[#8A8279] font-bold uppercase tracking-wide">
                      If found, ticket links to account. If not, saved as walk-in.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <label htmlFor="itemDescription" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Item Description</label>
                <textarea
                  id="itemDescription"
                  value={formData.itemDescription}
                  onChange={(e) => setFormData({ ...formData, itemDescription: e.target.value })}
                  className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8]"
                  placeholder="Describe the item (e.g., 18K gold necklace with diamond pendant, brand, condition, etc.)"
                  rows={3}
                  required
                />
              </div>

              <div className="space-y-3">
                <label htmlFor="itemPhotos" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Item Photos (required for auction listing)</label>
                <input
                  ref={fileInputRef}
                  id="itemPhotos"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setItemPhotoFiles(Array.from(e.target.files || []))}
                  className="w-full px-4 py-3 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 text-xs font-bold text-[#8A8279]"
                  required
                />
                <p className="text-[10px] text-[#8A8279] font-bold uppercase tracking-wide">
                  Upload one or more clear photos. These are required and will be used in Auction House item galleries.
                </p>
                {itemPhotoFiles.length > 0 ? (
                  <p className="text-[10px] text-[#C9A05C] font-black uppercase tracking-wide">
                    {itemPhotoFiles.length} photo{itemPhotoFiles.length > 1 ? 's' : ''} selected
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label htmlFor="customerContact" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Contact Number</label>
                  <div className="relative">
                    <input
                      id="customerContact"
                      type="text"
                      value={formData.customerContact}
                      onChange={(e) => setFormData({ ...formData, customerContact: e.target.value })}
                      className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8] pl-14"
                      placeholder="09XXXXXXXXX"
                      required
                    />
                    <Phone className="w-5 h-5 text-slate-300 absolute left-5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div className="space-y-3">
                  <label htmlFor="customerAddress" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Customer Address</label>
                  <div className="relative">
                    <input
                      id="customerAddress"
                      type="text"
                      value={formData.customerAddress}
                      onChange={(e) => setFormData({ ...formData, customerAddress: e.target.value })}
                      className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8] pl-14"
                      placeholder="Enter full address"
                      required
                    />
                    <MapPin className="w-5 h-5 text-slate-300 absolute left-5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
              </div>

              {customerDuplicate.checking && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[#1C1C26]/50 border border-[rgba(201,160,92,0.08)]">
                  <Loader2 className="w-3.5 h-3.5 text-[#8A8279] animate-spin" />
                  <p className="text-[10px] text-[#8A8279] font-bold uppercase tracking-wide">Checking for existing customer...</p>
                </div>
              )}
              {!customerDuplicate.checking && customerDuplicate.exists && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-[11px] font-bold text-amber-400 uppercase tracking-wide">Existing Customer Found</p>
                    <p className="text-[10px] text-[#8A8279] mt-0.5">{customerDuplicate.message}. The existing record will be updated with new information.</p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label htmlFor="itemWeight" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Weight (grams)</label>
                <div className="relative">
                  <input
                    id="itemWeight"
                    type="number"
                    step="0.01"
                    value={formData.weight}
                    onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                    className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8] pl-14"
                    placeholder="e.g. 5.25"
                    required
                  />
                  <Scale className="w-6 h-6 text-slate-300 absolute left-5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label htmlFor="appraisalDeadline" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Appraisal Deadline</label>
                  <input
                    id="appraisalDeadline"
                    type="date"
                    value={formData.appraisalDeadline}
                    onChange={(e) => setFormData({ ...formData, appraisalDeadline: e.target.value })}
                    className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8]"
                    required
                  />
                </div>
                <div className="space-y-3">
                  <label htmlFor="markForAuction" className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Auction Flag</label>
                  <div className="flex items-center gap-3 px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50">
                    <input
                      id="markForAuction"
                      type="checkbox"
                      checked={formData.markForAuction}
                      onChange={(e) => setFormData({ ...formData, markForAuction: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-[#C9A05C] focus:ring-[#C9A05C]"
                    />
                    <span className="text-[11px] font-bold text-[#B8B0A4] uppercase tracking-widest">Mark for auction</span>
                  </div>
                </div>
              </div>

              <button type="submit" className="w-full bg-[#C9A05C] text-[#0A0A0F] py-5 rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-[#E5C88C] shadow-xl transition-all">
                Calculate Risk & Loan Amount
              </button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-[#14141B] rounded-[2.5rem] p-8 shadow-sm border-none sticky top-8">
            <h3 className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest mb-8">Decision Support</h3>

            {isQuoting ? (
              <div className="text-center py-20">
                <Loader2 className="animate-spin mx-auto w-6 h-6 text-[#C9A05C]" />
                <p className="text-[10px] text-[#8A8279] font-black uppercase tracking-widest mt-4">Pricing item...</p>
              </div>
            ) : riskScore === null || !quoteDetails ? (
              <div className="text-center py-20">
                <p className="text-[10px] text-[#8A8279] font-black uppercase tracking-widest">Awaiting calculations...</p>
              </div>
            ) : (
              <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
                <div>
                  <p className="text-[10px] font-black text-[#8A8279] mb-4 uppercase tracking-widest">Risk Score</p>
                  <div className={`rounded-3xl p-6 ${RISK_BAND_STYLE[quoteDetails.risk.band]?.bg ?? 'bg-gray-50'}`}>
                    <div className="flex items-center gap-5">
                      <p className={`text-4xl font-black tracking-tighter ${RISK_BAND_STYLE[quoteDetails.risk.band]?.color ?? 'text-gray-600'}`}>{riskScore}%</p>
                      <p className={`text-[10px] font-black uppercase tracking-widest ${RISK_BAND_STYLE[quoteDetails.risk.band]?.color ?? 'text-gray-600'}`}>{quoteDetails.risk.band}</p>
                    </div>
                    {/* The factors behind the score. A risk number the appraiser
                        cannot interrogate is a number they have to trust, and the
                        old client-side curve gave no basis to question at all. */}
                    {quoteDetails.risk.factors.length > 0 && (
                      <ul className="mt-4 pt-4 border-t border-white/5 space-y-1">
                        {quoteDetails.risk.factors.map((factor) => (
                          <li key={factor} className="text-[10px] text-[#8A8279] font-bold uppercase tracking-wider">
                            • {factor}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-black text-[#8A8279] mb-4 uppercase tracking-widest">Loan Recommendation</p>
                  <div className="rounded-3xl p-6 bg-[#C9A05C]/10/50 border border-[rgba(201,160,92,0.15)]/50">
                    <p className="text-4xl font-black text-indigo-900 tracking-tighter">{formatCurrency(recommendedAmount)}</p>
                    {/* The basis of the figure, so the appraisal is auditable
                        rather than a bare number. */}
                    <dl className="mt-4 pt-4 border-t border-[rgba(201,160,92,0.15)] grid grid-cols-2 gap-y-1 text-[10px]">
                      <dt className="text-[#8A8279] font-bold uppercase tracking-wider">Appraised</dt>
                      <dd className="text-right font-black text-[#F5F0E8]">{formatCurrency(quoteDetails.appraisedValue)}</dd>
                      <dt className="text-[#8A8279] font-bold uppercase tracking-wider">Rate / gram</dt>
                      <dd className="text-right font-black text-[#F5F0E8]">{formatCurrency(quoteDetails.gramRate)}</dd>
                      <dt className="text-[#8A8279] font-bold uppercase tracking-wider">LTV</dt>
                      <dd className="text-right font-black text-[#F5F0E8]">{(quoteDetails.ltvRatio * 100).toFixed(0)}%</dd>
                      <dt className="text-[#8A8279] font-bold uppercase tracking-wider">Term</dt>
                      <dd className="text-right font-black text-[#F5F0E8]">{quoteDetails.termDays} days</dd>
                    </dl>
                    <p className="mt-3 text-[9px] text-[#5C574F] uppercase tracking-wider">
                      Pawn/melt basis, not spot
                    </p>
                  </div>
                </div>

                {quoteDetails.compliance.belowStatutoryMinimum && (
                  <div className="rounded-3xl p-5 bg-amber-500/10 border border-amber-500/30">
                    <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-2">
                      Below statutory minimum
                    </p>
                    <p className="text-[11px] text-[#B8B0A4] leading-relaxed">
                      {quoteDetails.compliance.note}
                    </p>
                  </div>
                )}

                <div className="space-y-4 pt-6">
                  <button 
                    onClick={handleApprove}
                    disabled={isSubmitting || !branchId}
                    className="w-full bg-[#030213] text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Submit for Approval'
                    )}
                  </button>
                  <p className="text-[9px] text-[#8A8279] text-center uppercase tracking-widest">Requires Manager/Owner Approval</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="w-full max-w-lg mx-4 rounded-[2rem] p-8 shadow-2xl"
            style={{ background: '#14141B', border: '1px solid rgba(201,160,92,0.15)' }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(201,160,92,0.1)' }}>
                <AlertCircle className="w-6 h-6" style={{ color: 'var(--gold)' }} />
              </div>
              <div>
                <h3 className="font-black text-[#F5F0E8] text-lg">Double Check</h3>
                <p className="text-[10px] text-[#8A8279] font-black uppercase tracking-widest">Review all details before submitting</p>
              </div>
            </div>

            <div className="space-y-3 mb-8">
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px] text-[#8A8279]">Ticket</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8]">{confirmData.ticketNumber}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px] text-[#8A8279]">Customer</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8]">{confirmData.customerName}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px] text-[#8A8279]">Contact</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8]">{confirmData.customerContact}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px] text-[#8A8279]">Address</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8] truncate max-w-[200px]">{confirmData.customerAddress}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px] text-[#8A8279]">Category</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8]">{confirmData.category}</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px] text-[#8A8279]">Weight</span>
                <span className="text-[11px] font-semibold text-[#F5F0E8]">{confirmData.weight}g</span>
              </div>
              <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[11px] text-[#8A8279]">Loan Amount</span>
                <span className="text-[11px] font-semibold text-[#C9A05C]">{formatCurrency(confirmData.loanAmount)}</span>
              </div>
              {confirmData.riskScore != null && (
                <div className="flex justify-between px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.035)' }}>
                  <span className="text-[11px] text-[#8A8279]">Risk Score</span>
                  <span
                    className={`text-[11px] font-semibold ${
                      (RISK_BAND_STYLE[confirmData.riskBand ?? ''] ?? getRiskStyle(confirmData.riskScore)).color
                    }`}
                  >
                    {confirmData.riskScore}% — {confirmData.riskBand ?? getRiskStyle(confirmData.riskScore).label}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleEdit}
                disabled={isConfirming}
                className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all border"
                style={{ borderColor: 'rgba(201,160,92,0.2)', color: 'var(--text-muted)' }}
              >
                Edit
              </button>
              <button
                onClick={handleConfirmApproval}
                disabled={isConfirming}
                className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--gold)', color: '#030213' }}
              >
                {isConfirming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Submit for Approval'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}