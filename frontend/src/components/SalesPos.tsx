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
      const res = await api.get<{ exists: boolean; customer?: { fullName: string }; message: string }>(
        '/customers/check',
        { fullName: name.trim(), contactNumber: contact.trim(), pawnshopId: branchId || undefined }
      );
      setCustomerDuplicate({ checking: false, exists: res.exists, message: res.exists ? res.message : '' });
    } catch {
      setCustomerDuplicate({ checking: false, exists: false, message: '' });
    }
  }, [branchId]);

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

  const calculateRisk = () => {
    const weight = parseFloat(formData.weight);
    if (isNaN(weight) || weight <= 0) {
      showToast("Please enter a valid weight/quantity.", "error");
      return;
    }

    // Risk & base rate per gram by precious-metal category.
    const categoryConfig: Record<string, { risk: (w: number) => number; rate: number }> = {
      'Gold Jewelry':        { risk: (w) => w > 50 ? 12 : 22, rate: 3200 },
      'Silver Jewelry':      { risk: (w) => w > 100 ? 20 : 32, rate: 42 },
      'Diamond Jewelry':     { risk: (w) => w > 10 ? 18 : 28, rate: 8000 },
      'Gold Coins':          { risk: (w) => w > 30 ? 10 : 18, rate: 3500 },
    };

    const config = categoryConfig[formData.itemCategory] || { risk: () => 50, rate: 500 };
    const risk = config.risk(weight);
    setRiskScore(risk);

    const amount = weight * config.rate * 0.7;
    setRecommendedAmount(Math.round(amount));
  };

  const handleApprove = async () => {
    if (!recommendedAmount) {
      showToast("Please calculate the loan amount first.", "error");
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
        riskScore: riskScore || undefined,
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
                  <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Customer Name</label>
                  <div className="relative">
                    <input
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
                  <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Item Category</label>
                  <select
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
                    <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">
                      Account Email (optional)
                    </label>
                    <input
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
                <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Item Description</label>
                <textarea
                  value={formData.itemDescription}
                  onChange={(e) => setFormData({ ...formData, itemDescription: e.target.value })}
                  className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8]"
                  placeholder="Describe the item (e.g., 18K gold necklace with diamond pendant, brand, condition, etc.)"
                  rows={3}
                  required
                />
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Item Photos (required for auction listing)</label>
                <input
                  ref={fileInputRef}
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
                  <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Contact Number</label>
                  <div className="relative">
                    <input
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
                  <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Customer Address</label>
                  <div className="relative">
                    <input
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
                <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Weight (grams)</label>
                <div className="relative">
                  <input
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
                  <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Appraisal Deadline</label>
                  <input
                    type="date"
                    value={formData.appraisalDeadline}
                    onChange={(e) => setFormData({ ...formData, appraisalDeadline: e.target.value })}
                    className="w-full px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50 focus:ring-2 focus:ring-[#C9A05C] outline-none transition-all font-bold text-[#F5F0E8]"
                    required
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Auction Flag</label>
                  <div className="flex items-center gap-3 px-6 py-4 rounded-2xl border border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50">
                    <input
                      type="checkbox"
                      checked={formData.markForAuction}
                      onChange={(e) => setFormData({ ...formData, markForAuction: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-[#C9A05C] focus:ring-[#C9A05C]"
                    />
                    <span className="text-[11px] font-bold text-[#B8B0A4] uppercase tracking-widest">Mark for auction</span>
                  </div>
                </div>
              </div>

              <button type="submit" className="w-full bg-[#C9A05C] text-white py-5 rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-[#E5C88C] shadow-xl transition-all">
                Calculate Risk & Loan Amount
              </button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-[#14141B] rounded-[2.5rem] p-8 shadow-sm border-none sticky top-8">
            <h3 className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest mb-8">Decision Support</h3>

            {riskScore === null ? (
              <div className="text-center py-20">
                <p className="text-[10px] text-[#8A8279] font-black uppercase tracking-widest">Awaiting calculations...</p>
              </div>
            ) : (
              <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
                <div>
                  <p className="text-[10px] font-black text-[#8A8279] mb-4 uppercase tracking-widest">Risk Score</p>
                  <div className={`rounded-3xl p-6 ${getRiskStyle(riskScore).bg}`}>
                    <div className="flex items-center gap-5">
                      <p className={`text-4xl font-black tracking-tighter ${getRiskStyle(riskScore).color}`}>{riskScore}%</p>
                      <p className={`text-[10px] font-black uppercase tracking-widest ${getRiskStyle(riskScore).color}`}>{getRiskStyle(riskScore).label}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-black text-[#8A8279] mb-4 uppercase tracking-widest">Loan Recommendation</p>
                  <div className="rounded-3xl p-6 bg-[#C9A05C]/10/50 border border-[rgba(201,160,92,0.15)]/50">
                    <p className="text-4xl font-black text-indigo-900 tracking-tighter">{formatCurrency(recommendedAmount)}</p>
                  </div>
                </div>

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
                  <span className={`text-[11px] font-semibold ${getRiskStyle(confirmData.riskScore).color}`}>
                    {confirmData.riskScore}% — {getRiskStyle(confirmData.riskScore).label}
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