import { useState, useEffect } from 'react';
import { Star, Loader2, CheckCircle2, MessageSquareQuote, ShieldCheck } from 'lucide-react';
import Swal from 'sweetalert2';
import api from '../lib/apiClient';

type ApprovedReview = {
  id: string;
  rating: number;
  title: string | null;
  comment: string;
  pawnshopName: string | null;
  createdAt: string;
};

type MyReview = {
  id: string;
  rating: number;
  title: string | null;
  comment: string;
  status: string;
  pawnshopName: string | null;
  createdAt: string;
};

export function ReviewsFeedback() {
  const [myReview, setMyReview] = useState<MyReview | null>(null);
  const [publicReviews, setPublicReviews] = useState<ApprovedReview[]>([]);
  const [summary, setSummary] = useState({ averageRating: 0, totalReviews: 0 });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const mine = await api.get<MyReview | null>('/reviews/mine');
      setMyReview(mine);
    } catch (err) {
      console.error('Failed to load your review:', err);
    }
    try {
      const data = await api.get<{ reviews: ApprovedReview[]; summary: { averageRating: number; totalReviews: number } }>('/reviews');
      setPublicReviews(data.reviews ?? []);
      setSummary(data.summary ?? { averageRating: 0, totalReviews: 0 });
    } catch (err) {
      console.error('Failed to load public reviews:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const submitReview = async () => {
    if (!comment.trim()) {
      showNotification('Please write your review before submitting', 'error');
      return;
    }
    if (comment.trim().length < 10) {
      showNotification('Your review must be at least 10 characters', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/reviews', { rating, title: title.trim() || undefined, comment: comment.trim() });
      showNotification('Review submitted successfully');
      setTitle('');
      setComment('');
      setRating(5);
      await fetchData();
    } catch (err: any) {
      showNotification(err?.message || 'Failed to submit review', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    void Swal.fire({
      toast: true,
      position: 'top',
      icon: type,
      title: message,
      showConfirmButton: false,
      timer: 3500,
      timerProgressBar: true,
    });
  };

  const renderStars = (value: number | null | undefined) => {
    const rounded = Math.round(value ?? 0);
    return (
      <div className="flex gap-1" aria-label={`${rounded} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            size={16}
            className={star <= rounded ? 'fill-[#C9A05C] text-[#C9A05C]' : 'text-[#3A3A44]'}
          />
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#C9A05C] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-light text-[#F5F0E8] tracking-tight">
            Reviews & <span className="font-bold text-[#C9A05C] italic">Feedback</span>
          </h1>
          <p className="text-[#8A8279] mt-2 font-medium italic">Rate the PawnGold platform and share your experience</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SUBMIT / MY REVIEW */}
        <div className="rounded-xl border border-[rgba(201,160,92,0.15)] bg-[#1C1C26] p-6 space-y-5">
          <h2 className="text-lg font-semibold text-[#F5F0E8] flex items-center gap-2">
            <MessageSquareQuote size={18} className="text-[#C9A05C]" />
            {myReview ? 'Your Review' : 'Share Your Experience'}
          </h2>

          {myReview ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {renderStars(myReview.rating)}
                {myReview.status === 'APPROVED' ? (
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={14} /> Published & visible on our website
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-amber-400">Awaiting moderation</span>
                )}
              </div>
              {myReview.title && <p className="font-semibold text-[#F5F0E8]">{myReview.title}</p>}
              <p className="text-sm text-[#B8B0A4] leading-relaxed">{myReview.comment}</p>
              <p className="text-xs text-[#8A8279]">
                Posted on {new Date(myReview.createdAt).toLocaleDateString()} · One review per account
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-[#B8B0A4] mb-2">Your rating</p>
                <div
                  className="flex gap-2"
                  role="radiogroup"
                  aria-label="Select rating"
                  onMouseLeave={() => setHoverRating(0)}
                >
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      role="radio"
                      aria-checked={rating === star}
                      aria-label={`Rate ${star} out of 5`}
                      onClick={() => setRating(star)}
                      onFocus={() => setHoverRating(star)}
                      onMouseEnter={() => setHoverRating(star)}
                      className="transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A05C] rounded"
                    >
                      <Star
                        size={28}
                        className={
                          (hoverRating || rating) >= star
                            ? 'fill-[#C9A05C] text-[#C9A05C]'
                            : 'text-[#3A3A44]'
                        }
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="review-title" className="text-sm text-[#B8B0A4] block mb-1">
                  Title <span className="text-[#8A8279]">(optional)</span>
                </label>
                <input
                  id="review-title"
                  type="text"
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A short summary of your experience"
                  className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#F5F0E8] text-sm focus:outline-none focus:border-[#C9A05C]/50"
                />
              </div>
              <div>
                <label htmlFor="review-comment" className="text-sm text-[#B8B0A4] block mb-1">
                  Review <span className="text-[#8A8279]">(minimum 10 characters)</span>
                </label>
                <textarea
                  id="review-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="Tell us what worked well and what we can improve."
                  className="w-full px-4 py-3 bg-[#0D0D14] border border-[rgba(201,160,92,0.15)] rounded-xl text-[#F5F0E8] text-sm focus:outline-none focus:border-[#C9A05C]/50 resize-none"
                />
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-[#0D0D14] border border-[rgba(201,160,92,0.1)]">
                <ShieldCheck size={16} className="text-[#C9A05C] mt-0.5 shrink-0" />
                <p className="text-xs text-[#8A8279] leading-relaxed">
                  By submitting, you consent to your review and your pawnshop name being publicly displayed
                  on the PawnGold website. Your personal name is never shown. Only one review per account is allowed.
                </p>
              </div>

              <button
                onClick={submitReview}
                disabled={submitting}
                className="px-5 py-2.5 bg-[#C9A05C] text-[#1C1C26] rounded-xl font-semibold text-sm hover:bg-[#C9A05C]/90 transition-all disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Submit Review'}
              </button>
            </div>
          )}
        </div>

        {/* COMMUNITY REVIEWS */}
        <div className="rounded-xl border border-[rgba(201,160,92,0.15)] bg-[#1C1C26] p-6 space-y-5">
          <h2 className="text-lg font-semibold text-[#F5F0E8] flex items-center gap-2">
            Community Reviews
          </h2>
          {publicReviews.length > 0 && (
            <div className="flex items-center gap-4 p-4 rounded-lg bg-[#0D0D14] border border-[rgba(201,160,92,0.1)]">
              <p className="text-4xl font-bold text-[#C9A05C]">{summary.averageRating}</p>
              <div>
                {renderStars(summary.averageRating)}
                <p className="text-xs text-[#8A8279] mt-1">Based on {summary.totalReviews} verified review{summary.totalReviews !== 1 ? 's' : ''}</p>
              </div>
            </div>
          )}
          {publicReviews.length === 0 ? (
            <p className="text-sm text-[#8A8279] text-center py-10">
              No published reviews yet. Be the first to share your experience.
            </p>
          ) : (
            <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
              {publicReviews.map((review) => (
                <div key={review.id} className="p-4 rounded-lg bg-[#0D0D14] border border-[rgba(201,160,92,0.08)]">
                  <div className="flex items-center justify-between mb-2">
                    {renderStars(review.rating)}
                    <span className="text-xs text-[#8A8279]">{new Date(review.createdAt).toLocaleDateString()}</span>
                  </div>
                  {review.title && <p className="font-semibold text-[#F5F0E8] text-sm">{review.title}</p>}
                  <p className="text-sm text-[#B8B0A4] leading-relaxed mt-1">{review.comment}</p>
                  <p className="text-xs text-[#C9A05C] font-medium mt-3">
                    {review.pawnshopName ? `${review.pawnshopName} · Verified Owner` : 'Verified Owner'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}