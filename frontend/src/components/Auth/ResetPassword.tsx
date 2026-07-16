import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type RecoveryState = 'validating' | 'ready' | 'invalid' | 'done';

function parseHashParams(): URLSearchParams {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash);
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [state, setState] = useState<RecoveryState>('validating');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tokenData = useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = parseHashParams();

    return {
      code: search.get('code') || hash.get('code'),
      tokenHash: search.get('token_hash') || hash.get('token_hash'),
      type: search.get('type') || hash.get('type'),
      accessToken: search.get('access_token') || hash.get('access_token'),
      refreshToken: search.get('refresh_token') || hash.get('refresh_token'),
    };
  }, []);

  useEffect(() => {
    const bootstrapRecoverySession = async () => {
      setError(null);

      try {
        // Supabase can automatically consume URL tokens before this component runs.
        // If a session already exists, allow password reset immediately.
        const {
          data: { session: existingSession },
        } = await supabase.auth.getSession();
        if (existingSession?.access_token) {
          setState('ready');
          return;
        }

        if (tokenData.code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(tokenData.code);
          if (exchangeError) throw exchangeError;
          setState('ready');
          return;
        }

        if (tokenData.tokenHash && tokenData.type === 'recovery') {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenData.tokenHash,
            type: 'recovery',
          });
          if (verifyError) throw verifyError;
          setState('ready');
          return;
        }

        if (tokenData.accessToken && tokenData.refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: tokenData.accessToken,
            refresh_token: tokenData.refreshToken,
          });
          if (sessionError) throw sessionError;
          setState('ready');
          return;
        }

        if (tokenData.accessToken && !tokenData.refreshToken) {
          const {
            data: { session: refreshedSession },
          } = await supabase.auth.getSession();
          if (refreshedSession?.access_token) {
            setState('ready');
            return;
          }

          throw new Error('Reset link is incomplete. Please request a new password reset email.');
        }

        throw new Error('Invalid or expired reset link. Please request a new one.');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err) || 'Failed to validate reset link');
        setState('invalid');
      }
    };

    bootstrapRecoverySession();
  }, [tokenData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setState('done');
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1C1C26] p-4 font-sans">
      <Card className="w-full max-w-md rounded-[2.5rem] border-none shadow-2xl overflow-hidden">
        <CardHeader className="bg-[#030213] text-white p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-[#C9A05C] rounded-2xl shadow-lg shadow-[rgba(201,160,92,0.3)]">
              <Lock className="text-white w-8 h-8" />
            </div>
          </div>
          <CardTitle className="text-2xl font-black uppercase italic tracking-tighter">
            Reset Password
          </CardTitle>
          <p className="text-[#6B655C] text-[10px] font-black uppercase tracking-[0.2em] mt-2">PawnGold Account Recovery</p>
        </CardHeader>

        <CardContent className="p-8 space-y-6 bg-[#14141B]">
          {state === 'validating' && (
            <div className="flex items-center justify-center gap-3 text-[#6B655C] font-bold text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-[#C9A05C]" />
              Validating reset link...
            </div>
          )}

          {state === 'invalid' && (
            <div className="p-4 bg-red-50 text-red-700 text-[11px] font-bold rounded-2xl border border-red-100 italic text-left flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error || 'Invalid reset link'}</span>
            </div>
          )}

          {state === 'done' && (
            <div className="p-4 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-2xl border border-emerald-100 text-left flex items-start gap-2">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>Password updated successfully. Redirecting to login...</span>
            </div>
          )}

          {state === 'ready' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2 text-left">
                <label className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest ml-1">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3.5 bg-[#1C1C26] border-none rounded-2xl focus:ring-2 focus:ring-[#C9A05C] outline-none font-bold text-[#EAE2D6] transition-all"
                  placeholder="Minimum 8 characters"
                  minLength={8}
                  required
                />
              </div>

              <div className="space-y-2 text-left">
                <label className="text-[10px] font-black text-[#6B655C] uppercase tracking-widest ml-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3.5 bg-[#1C1C26] border-none rounded-2xl focus:ring-2 focus:ring-[#C9A05C] outline-none font-bold text-[#EAE2D6] transition-all"
                  placeholder="Re-enter password"
                  minLength={8}
                  required
                />
              </div>

              {error && (
                <div className="p-4 bg-red-50 text-red-600 text-[11px] font-bold rounded-2xl border border-red-100 italic text-left flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-[#030213] text-white rounded-2xl font-black uppercase tracking-widest hover:bg-[#C9A05C] transition-all shadow-xl shadow-[rgba(201,160,92,0.1)] flex items-center justify-center gap-2 mt-4 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </form>
          )}

          {(state === 'invalid' || state === 'done') && (
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="w-full py-3 bg-[#1C1C26] text-slate-800 rounded-2xl font-black uppercase tracking-widest hover:bg-[#222228] transition-all"
            >
              Back to Login
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
