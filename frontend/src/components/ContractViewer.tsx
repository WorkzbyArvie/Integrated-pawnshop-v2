import { useEffect, useState, useRef } from 'react';
import {
  FileText, Loader2, XCircle, X, FileDown, PenLine, CheckCircle2, ShieldCheck, Upload,
} from 'lucide-react';
import api from '../lib/apiClient';
import { formatDateTime, humanizeStatus } from '../lib/formatters';
import Swal from 'sweetalert2';

type ContractData = {
  id: string;
  contractNumber: string;
  templateVersion: string;
  contractData?: Record<string, unknown>;
  pdfUrl?: string | null;
  signedByCustomer: boolean;
  customerSignature?: string | null;
  customerSignedAt?: string | null;
  signedByStaff: boolean;
  staffSignature?: string | null;
  staffId?: string | null;
  staffSignedAt?: string | null;
  generatedAt: string;
};

function extractContractTerms(html: string): string {
  const headingPattern = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const sections: { heading: string; start: number; nextStart: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(html)) !== null) {
    const heading = match[1].replace(/<[^>]*>/g, '').trim().toUpperCase();
    if (sections.length > 0) {
      sections[sections.length - 1].nextStart = match.index;
    }
    sections.push({ heading, start: match.index, nextStart: html.length });
  }
  return sections
    .filter((section) => /TERMS|CONDITIONS|RESPONSIBILIT/.test(section.heading))
    .map((section) => html.slice(section.start, section.nextStart))
    .join('\n')
    .trim();
}

interface ContractViewerProps {
  applicationId?: string;
  contractId?: string;
  open: boolean;
  onClose: () => void;
  userRole?: string;
  userId?: string;
  onSignComplete?: () => void;
  onDisburse?: () => void;
  disbursing?: boolean;
}

export function ContractViewer({
  applicationId, contractId, open, onClose, userRole, userId, onSignComplete, onDisburse, disbursing,
}: ContractViewerProps) {
  const [contract, setContract] = useState<ContractData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureUploaded, setSignatureUploaded] = useState(false);
  const [signatureFor, setSignatureFor] = useState<'customer' | 'staff' | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const customerCanvasRef = useRef<HTMLCanvasElement>(null);
  const staffCanvasRef = useRef<HTMLCanvasElement>(null);
  const customerFileRef = useRef<HTMLInputElement>(null);
  const staffFileRef = useRef<HTMLInputElement>(null);

  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fetchContract = async () => {
      setLoading(true);
      setError(null);
      try {
        let result: ContractData;
        if (contractId) {
          result = await api.get<ContractData>(`/loan/contract/${contractId}`);
        } else if (applicationId) {
          result = await api.get<ContractData>(`/loan/contracts/${applicationId}`);
        } else {
          return;
        }
        setContract(result);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchContract();
  }, [applicationId, contractId, open]);

  const activeCanvas = () => {
    if (signatureFor === 'staff') return staffCanvasRef.current;
    return customerCanvasRef.current;
  };

  const setActiveSigner = (type: 'customer' | 'staff') => {
    setSignatureFor(type);
    setSignature(null);
    setSignatureUploaded(false);
  };

  const clearCanvas = () => {
    const canvas = activeCanvas();
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    setSignature(null);
    setSignatureUploaded(false);
  };

  const handleUploadSignature = (type: 'customer' | 'staff', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG or JPG).');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setActiveSigner(type);
      setSignature(String(reader.result));
      setSignatureUploaded(true);
      setIsDrawing(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const canvas = activeCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = activeCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e293b';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = activeCanvas();
    if (canvas) {
      setSignature(canvas.toDataURL());
    }
  };

  const handleSign = async (type: 'customer' | 'staff') => {
    if (!applicationId || !signature) return;
    setSigning(true);
    try {
      if (type === 'customer') {
        await api.patch(`/loan/contracts/${applicationId}/sign-customer`, {
          customerSignature: signature,
        });
      } else {
        await api.patch(`/loan/contracts/${applicationId}/sign-staff`, {
          staffId: userId,
          staffSignature: signature,
          userRole,
        });
      }
      const updated = {
        signedByCustomer: type === 'customer' ? true : (contract?.signedByCustomer ?? false),
        customerSignedAt: type === 'customer' ? new Date().toISOString() : (contract?.customerSignedAt ?? null),
        customerSignature: type === 'customer' ? signature : (contract?.customerSignature ?? null),
        signedByStaff: type === 'staff' ? true : (contract?.signedByStaff ?? false),
        staffSignedAt: type === 'staff' ? new Date().toISOString() : (contract?.staffSignedAt ?? null),
        staffSignature: type === 'staff' ? signature : (contract?.staffSignature ?? null),
      };
      setContract((prev) => (prev ? { ...prev, ...updated } : prev));
      setSignature(null);
      setSignatureUploaded(false);
      clearCanvas();
      if (onSignComplete && updated.signedByCustomer && updated.signedByStaff) {
        onSignComplete();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigning(false);
    }
  };

  const handleRequestDisburse = async () => {
    if (!onDisburse) return;
    const confirm = await Swal.fire({
      title: 'Confirm Disbursement',
      text: `Disburse loan ${contract?.contractNumber ? `for ${contract.contractNumber}` : ''} and activate it? This releases the loan amount and cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3DA86C',
      cancelButtonColor: '#8A8279',
      confirmButtonText: 'Yes, disburse',
      cancelButtonText: 'Cancel',
    });
    if (!confirm.isConfirmed) return;
    onDisburse();
  };

  const handleDownloadPdf = async () => {
    if (!contract) return;
    setDownloading(true);
    try {
      const headers: Record<string, string> = {};
      const { supabase: supa } = await import('../lib/supabaseClient');
      const { data: { session } } = await supa.auth.getSession();
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      const pawnshopId = localStorage.getItem('active_pawnshop_id') ?? '';
      if (pawnshopId) headers['pawnshop-id'] = pawnshopId;

      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/loan/contracts/${contract.id}/pdf`, { headers });
      if (!res.ok) throw new Error('Failed to download PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${contract.contractNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const termsHtml =
    contract?.contractData?.renderedHtml && typeof contract.contractData.renderedHtml === 'string'
      ? extractContractTerms(contract.contractData.renderedHtml as string)
      : '';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-[#14141B] rounded-[2.5rem] shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="sticky top-0 bg-[#14141B] border-b border-[rgba(201,160,92,0.08)] px-8 py-5 flex items-center justify-between rounded-t-[2.5rem] z-10">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-[#C9A05C]" />
            <h2 className="text-lg font-black text-[#F5F0E8] uppercase tracking-tight">
              Contract
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-[#1C1C26] flex items-center justify-center hover:bg-[#222228] transition-colors"
          >
            <X className="w-5 h-5 text-[#B8B0A4]" />
          </button>
        </div>

        <div className="p-8">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin mb-3" />
              <p className="text-[10px] font-black uppercase tracking-widest text-[#8A8279]">Loading Contract...</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 text-rose-600">
              <XCircle className="w-5 h-5" />
              <p className="text-sm font-bold">{error}</p>
            </div>
          )}

          {!loading && !error && contract && (
            <div className="space-y-6">
              <div className="bg-[#C9A05C]/10 rounded-2xl border border-[rgba(201,160,92,0.15)] p-5 space-y-2">
                <p className="text-lg font-black text-indigo-900">{contract.contractNumber}</p>
                <p className="text-xs font-bold text-[#C9A05C]">
                  Version: {contract.templateVersion} -- Generated {formatDateTime(contract.generatedAt)}
                </p>
              </div>

              {contract.contractData && (
                <div className="border border-[rgba(201,160,92,0.08)] rounded-2xl p-5 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-[#8A8279] mb-3">Contract Details</p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {Object.entries(contract.contractData).map(([key, val]) => {
                      if (key === 'renderedHtml' || key === 'loanId' || typeof val === 'object') return null;
                      return (
                        <div key={key}>
                          <p className="text-[10px] font-black uppercase tracking-wider text-[#8A8279]">
                            {humanizeStatus(key)}
                          </p>
                          <p className="font-bold text-[#F5F0E8]">{String(val)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {termsHtml && (
                <div className="rounded-2xl border border-[rgba(201,160,92,0.12)] overflow-hidden">
                  <div className="px-5 py-3 bg-[#1C1C26] border-b border-[rgba(201,160,92,0.12)]">
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#C9A05C]">
                      Terms &amp; Conditions &amp; Pawnshop Responsibilities
                    </p>
                  </div>
                  <div
                    className="bg-[#14141B] text-[#F5F0E8] p-6 max-h-96 overflow-y-auto text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: termsHtml }}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={`border rounded-2xl p-5 ${contract.signedByCustomer ? 'border-emerald-200 bg-emerald-50' : 'border-[rgba(201,160,92,0.12)]'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    {contract.signedByCustomer ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <PenLine className="w-5 h-5 text-[#8A8279]" />
                    )}
                    <p className="text-sm font-black text-[#F5F0E8]">Customer Signature</p>
                  </div>
                  {contract.signedByCustomer ? (
                    <div className="space-y-1">
                      {contract.customerSignature && (
                        <img src={contract.customerSignature} alt="Customer signature" className="max-h-16 border border-[rgba(201,160,92,0.12)] rounded-lg" />
                      )}
                      {contract.customerSignedAt && (
                        <p className="text-[10px] font-bold text-[#8A8279]">Signed {formatDateTime(contract.customerSignedAt)}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {signatureUploaded && signatureFor === 'customer' ? (
                        <div className="space-y-1">
                          <img src={signature ?? undefined} alt="Uploaded customer signature" className="max-h-16 border border-[#C9A05C]/40 rounded-xl bg-white p-1" />
                          <p className="text-[10px] font-bold text-[#8A8279]">Uploaded signature — ready to sign</p>
                        </div>
                      ) : (
                        <canvas
                          ref={customerCanvasRef}
                          width={400}
                          height={100}
                          className="w-full border border-dashed border-slate-300 rounded-xl bg-[#14141B] touch-none"
                          style={{ cursor: 'crosshair' }}
                          onMouseDown={(e) => { setActiveSigner('customer'); startDrawing(e); }}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={(e) => { setActiveSigner('customer'); startDrawing(e); }}
                          onTouchMove={draw}
                          onTouchEnd={stopDrawing}
                        />
                      )}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        ref={customerFileRef}
                        onChange={(e) => handleUploadSignature('customer', e)}
                      />
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => customerFileRef.current?.click()}
                          className="px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.25)] text-xs font-bold text-[#C9A05C] hover:bg-[#1C1C26] inline-flex items-center gap-1"
                        >
                          <Upload className="w-3 h-3" />
                          Upload Signature
                        </button>
                        <button
                          onClick={() => { setActiveSigner('customer'); clearCanvas(); }}
                          className="px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.12)] text-xs font-bold text-[#B8B0A4] hover:bg-[#1C1C26]"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => { setActiveSigner('customer'); handleSign('customer'); }}
                          disabled={!signature || signing}
                          className="px-4 py-2 rounded-xl bg-[#C9A05C] text-white text-xs font-bold hover:bg-[#E5C88C] disabled:opacity-50"
                        >
                          {signing ? 'Signing...' : 'Sign as Customer'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className={`border rounded-2xl p-5 ${contract.signedByStaff ? 'border-emerald-200 bg-emerald-50' : 'border-[rgba(201,160,92,0.12)]'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    {contract.signedByStaff ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <ShieldCheck className="w-5 h-5 text-[#8A8279]" />
                    )}
                    <p className="text-sm font-black text-[#F5F0E8]">Staff Signature</p>
                  </div>
                  {contract.signedByStaff ? (
                    <div className="space-y-1">
                      {contract.staffSignature && (
                        <img src={contract.staffSignature} alt="Staff signature" className="max-h-16 border border-[rgba(201,160,92,0.12)] rounded-lg" />
                      )}
                      {contract.staffSignedAt && (
                        <p className="text-[10px] font-bold text-[#8A8279]">Signed {formatDateTime(contract.staffSignedAt)}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {signatureUploaded && signatureFor === 'staff' ? (
                        <div className="space-y-1">
                          <img src={signature ?? undefined} alt="Uploaded staff signature" className="max-h-16 border border-[#C9A05C]/40 rounded-xl bg-white p-1" />
                          <p className="text-[10px] font-bold text-[#8A8279]">Uploaded signature — ready to sign</p>
                        </div>
                      ) : (
                        <canvas
                          ref={staffCanvasRef}
                          width={400}
                          height={100}
                          className="w-full border border-dashed border-slate-300 rounded-xl bg-[#14141B] touch-none"
                          style={{ cursor: 'crosshair' }}
                          onMouseDown={(e) => { setActiveSigner('staff'); startDrawing(e); }}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={(e) => { setActiveSigner('staff'); startDrawing(e); }}
                          onTouchMove={draw}
                          onTouchEnd={stopDrawing}
                        />
                      )}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        ref={staffFileRef}
                        onChange={(e) => handleUploadSignature('staff', e)}
                      />
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => staffFileRef.current?.click()}
                          className="px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.25)] text-xs font-bold text-[#C9A05C] hover:bg-[#1C1C26] inline-flex items-center gap-1"
                        >
                          <Upload className="w-3 h-3" />
                          Upload Signature
                        </button>
                        <button
                          onClick={() => { setActiveSigner('staff'); clearCanvas(); }}
                          className="px-4 py-2 rounded-xl border border-[rgba(201,160,92,0.12)] text-xs font-bold text-[#B8B0A4] hover:bg-[#1C1C26]"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => { setActiveSigner('staff'); handleSign('staff'); }}
                          disabled={!signature || signing}
                          className="px-4 py-2 rounded-xl bg-[#C9A05C] text-white text-xs font-bold hover:bg-[#E5C88C] disabled:opacity-50"
                        >
                          {signing ? 'Signing...' : 'Sign as Staff'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {contract ? (
                  <button
                    onClick={handleDownloadPdf}
                    disabled={downloading}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#C9A05C] text-white text-sm font-bold hover:bg-[#E5C88C] transition-colors disabled:opacity-50"
                  >
                    <FileDown className="w-4 h-4" />
                    {downloading ? 'Downloading...' : 'Download Contract PDF'}
                  </button>
                ) : (
                  <button
                    disabled
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#8A8279]/30 text-[#B8B0A4] text-sm font-bold cursor-not-allowed"
                  >
                    <FileDown className="w-4 h-4" />
                    PDF Not Available
                  </button>
                )}
                {contract.signedByCustomer && contract.signedByStaff && onDisburse && (
                  <button
                    onClick={handleRequestDisburse}
                    disabled={disbursing}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#3DA86C] text-white text-sm font-bold hover:bg-[#4DB87C] transition-colors disabled:opacity-50"
                  >
                    <FileDown className="w-4 h-4" />
                    {disbursing ? 'Disbursing...' : 'Disburse Loan'}
                  </button>
                )}
              </div>
              {contract.signedByCustomer && contract.signedByStaff && (
                <div className="mt-4 px-4 py-3 rounded-2xl bg-[#3DA86C]/10 border border-[#3DA86C]/20 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-[#3DA86C]" />
                  <p className="text-sm font-bold text-[#F5F0E8]">Signed by both parties — ready for disbursement</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
