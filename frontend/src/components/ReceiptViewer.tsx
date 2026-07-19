import { useEffect, useState } from 'react';
import {
  Receipt, Loader2, XCircle, ExternalLink, X, FileDown,
} from 'lucide-react';
import api from '../lib/apiClient';
import { formatCurrency, formatDateTime, humanizeStatus } from '../lib/formatters';

type ReceiptData = {
  id: string;
  receiptNumber: string;
  receiptType: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  customerName: string;
  isVoid: boolean;
  voidReason?: string | null;
  generatedAt: string;
  pdfUrl?: string | null;
  lineItems?: Array<{ description: string; amount: number; quantity?: number }>;
};

interface ReceiptViewerProps {
  receiptId?: string;
  referenceType?: string;
  referenceId?: string;
  open: boolean;
  onClose: () => void;
}

export function ReceiptViewer({ receiptId, referenceType, referenceId, open, onClose }: ReceiptViewerProps) {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const fetchReceipt = async () => {
      setLoading(true);
      setError(null);
      try {
        if (receiptId) {
          const r = await api.get<ReceiptData>(`/receipts/${receiptId}`);
          setReceipt(r);
          const pdf = await api.get<{ pdfUrl: string }>(`/receipts/${receiptId}/pdf`);
          setPdfUrl(pdf.pdfUrl);
          setReceipts([]);
        } else if (referenceType && referenceId) {
          const list = await api.get<ReceiptData[]>(
            `/receipts/by-reference/${referenceType}/${referenceId}`,
          );
          setReceipts(Array.isArray(list) ? list : []);
          setReceipt(null);
          setPdfUrl(null);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchReceipt();
  }, [receiptId, referenceType, referenceId, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-[#14141B] rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="sticky top-0 bg-[#14141B] border-b border-[rgba(201,160,92,0.08)] px-8 py-5 flex items-center justify-between rounded-t-[2.5rem]">
          <div className="flex items-center gap-3">
            <Receipt className="w-5 h-5 text-[#C9A05C]" />
            <h2 className="text-lg font-black text-[#EAE2D6] uppercase tracking-tight">
              {receiptId ? 'Receipt' : 'Receipts'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-[#1C1C26] flex items-center justify-center hover:bg-[#222228] transition-colors"
          >
            <X className="w-5 h-5 text-[#999186]" />
          </button>
        </div>

        <div className="p-8">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin mb-3" />
              <p className="text-[10px] font-black uppercase tracking-widest text-[#6B655C]">Loading...</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 text-rose-600">
              <XCircle className="w-5 h-5" />
              <p className="text-sm font-bold">{error}</p>
            </div>
          )}

          {!loading && !error && receipt && (
            <div className="space-y-6">
              <div className={`flex items-center justify-between ${receipt.isVoid ? 'opacity-60' : ''}`}>
                <div>
                  <p className="text-2xl font-black text-[#EAE2D6]">{receipt.receiptNumber}</p>
                  <p className="text-sm font-bold text-[#6B655C] mt-1">
                    {humanizeStatus(receipt.receiptType)} -- {receipt.customerName}
                  </p>
                </div>
                {receipt.isVoid && (
                  <div className="px-4 py-2 rounded-xl bg-rose-100 text-rose-700 text-xs font-black uppercase tracking-wider">
                    Voided
                  </div>
                )}
              </div>

              {receipt.lineItems && receipt.lineItems.length > 0 && (
                <div className="border border-[rgba(201,160,92,0.08)] rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-[#1C1C26]">
                      <tr>
                        <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Item</th>
                        <th className="px-5 py-3 text-right text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipt.lineItems.map((item, idx) => (
                        <tr key={idx} className="border-t border-[rgba(201,160,92,0.08)]">
                          <td className="px-5 py-3 text-sm font-bold text-[#EAE2D6]">
                            {item.description}
                            {item.quantity && item.quantity > 1 && ` x${item.quantity}`}
                          </td>
                          <td className="px-5 py-3 text-sm font-bold text-[#EAE2D6] text-right">
                            {formatCurrency(item.amount * (item.quantity || 1))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t border-[rgba(201,160,92,0.08)] px-5 py-3 flex justify-between bg-[#1C1C26]">
                    <span className="text-xs font-bold text-[#6B655C]">Subtotal</span>
                    <span className="text-sm font-bold text-[#EAE2D6]">{formatCurrency(receipt.amount)}</span>
                  </div>
                  {receipt.taxAmount > 0 && (
                    <div className="border-t border-[rgba(201,160,92,0.08)] px-5 py-3 flex justify-between bg-[#1C1C26]">
                      <span className="text-xs font-bold text-[#6B655C]">Tax</span>
                      <span className="text-sm font-bold text-[#EAE2D6]">{formatCurrency(receipt.taxAmount)}</span>
                    </div>
                  )}
                  <div className="border-t border-[rgba(201,160,92,0.08)] px-5 py-4 flex justify-between bg-[#C9A05C]/10">
                    <span className="text-xs font-black uppercase tracking-wider text-[#C9A05C]">Total</span>
                    <span className="text-lg font-black text-indigo-900">{formatCurrency(receipt.totalAmount)}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Date</p>
                  <p className="font-bold text-[#EAE2D6]">{formatDateTime(receipt.generatedAt)}</p>
                </div>
                {receipt.isVoid && receipt.voidReason && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#6B655C]">Void Reason</p>
                    <p className="font-bold text-rose-600">{receipt.voidReason}</p>
                  </div>
                )}
              </div>

              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#C9A05C] text-white text-sm font-bold hover:bg-[#E5C88C] transition-colors"
                >
                  <FileDown className="w-4 h-4" />
                  Download PDF
                </a>
              )}
            </div>
          )}

          {!loading && !error && receipts.length > 0 && !receipt && (
            <div className="space-y-3">
              {receipts.map((r) => (
                <div
                  key={r.id}
                  className="border border-[rgba(201,160,92,0.08)] rounded-2xl p-5 flex items-center justify-between hover:border-[rgba(201,160,92,0.2)] transition-colors"
                >
                  <div>
                    <p className="text-sm font-black text-[#EAE2D6]">{r.receiptNumber}</p>
                    <p className="text-xs font-bold text-[#6B655C] mt-0.5">
                      {humanizeStatus(r.receiptType)} -- {formatCurrency(r.totalAmount)}
                    </p>
                    <p className="text-[10px] font-semibold text-[#6B655C]">{formatDateTime(r.generatedAt)}</p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const detail = await api.get<ReceiptData>(`/receipts/${r.id}`);
                        setReceipt(detail);
                        const pdf = await api.get<{ pdfUrl: string }>(`/receipts/${r.id}/pdf`);
                        setPdfUrl(pdf.pdfUrl);
                      } catch (err: unknown) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                    className="text-[#C9A05C] hover:text-[#C9A05C]"
                  >
                    <ExternalLink className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
