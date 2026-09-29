import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import api, { getApiErrorDetails } from '../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Lock, Mail, AlertTriangle, ChevronLeft } from "lucide-react";
import { PasswordField } from './PasswordField';

const LOGIN_COPY = {
  email: 'Email address',
  password: 'Password',
  submit: 'Authenticate Access',
  submitting: 'Verifying',
  failure: "We couldn't sign you in. Check your email and password and try again.",
  recoveryEntry: 'Forgot Password?',
  recoveryRoute: '/reset-password',
} as const;

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/', { replace: true });
  };


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError || !authData?.user) {
        console.warn('[LOGIN] Supabase auth rejected the sign-in attempt');
        throw new Error(LOGIN_COPY.failure);
      }

      // Resolved server-side by the authenticated id only. The direct `profiles`
      // read this replaces had an `.eq('email', email)` fallback, which let any
      // signed-in caller ask for an arbitrary address's role and shop - an
      // enumeration oracle that no Row Level Security policy can close, because
      // the policy would have to decide who may ask before the caller has proved
      // anything. The id lookup also closes as soon as sign-in succeeds.
      let profileData: {
        role: string | null;
        pawnshopId: string | null;
        branchId: number | null;
      } | null = null;

      let sessionContextError: unknown = null;
      try {
        profileData = await api.get('/profile/session-context');
      } catch (err: unknown) {
        sessionContextError = err;
        console.warn('[LOGIN] Session context fetch failed:', err);
      }

      if (!profileData) {
        // The Supabase session is valid; it is the *profile* read that failed. Which
        // failure decides whether this login can continue.
        //
        // A guard denial is not "no profile". It means the server identified the
        // caller and refused the read - MFA assertion missing, or a forced password
        // change. Building a profile out of user_metadata in that state fabricates
        // a role and a tenant the server never granted, then writes them to
        // localStorage as if they were authoritative. That is what produced a
        // signed-in user staring at an empty dashboard while every request 403'd,
        // and it is how a client-supplied tenant got a foothold in the first place.
        // Hand off to App.tsx, which already gates on server-owned credential
        // state, instead of inventing an identity here.
        const guardCode = getApiErrorDetails(sessionContextError).code;
        if (
          guardCode === 'MFA_VERIFICATION_REQUIRED' ||
          guardCode === 'PASSWORD_CHANGE_REQUIRED'
        ) {
          localStorage.removeItem('user_role');
          localStorage.removeItem('active_pawnshop_id');
          localStorage.removeItem('active_branch_id');
          setPassword('');
          navigate('/', { replace: true });
          return;
        }

        console.warn('[LOGIN] No profile found, using metadata/local fallback');
        const fallbackRole = authData.user?.user_metadata?.role || authData.user?.app_metadata?.role || 'STAFF';
        const fallbackPawnshopId = authData.user?.user_metadata?.pawnshop_id || authData.user?.app_metadata?.pawnshop_id || null;
        profileData = {
          role: fallbackRole,
          pawnshopId: fallbackPawnshopId,
          branchId: authData.user?.user_metadata?.branch_id || authData.user?.app_metadata?.branch_id || null,
        };
      }

      // 3. Normalize role
      const rawRole = profileData.role || 'STAFF';
      const cleaned = rawRole.toString().toUpperCase().replace(/[_\s]/g, '');
      const userRole = ((): string => {
        switch (cleaned) {
          case 'SUPERADMIN':
          case 'SUPER':
          case 'SUPER_ADMIN':
            return 'Super Admin';
          case 'BRANCHADMIN':
          case 'BRANCH_ADMIN':
            return 'Admin';
          case 'ADMIN':
            return 'Admin';
          case 'MANAGER':
            return 'Manager';
          case 'OWNER':
            return 'Owner';
          case 'HR':
          case 'HUMANRESOURCES':
          case 'HUMAN_RESOURCES':
            return 'HR';
          case 'STAFF':
          default:
            return rawRole.split(/[_\s]+/).map((w: string) => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
      })();

      // 4. Store session
      localStorage.setItem('user_role', userRole);
      localStorage.setItem('user_email', email);
      if (profileData.pawnshopId) {
        localStorage.setItem('active_pawnshop_id', profileData.pawnshopId);
      } else {
        localStorage.removeItem('active_pawnshop_id');
      }
      if (profileData.branchId) {
        localStorage.setItem('active_branch_id', String(profileData.branchId));
      } else {
        localStorage.removeItem('active_branch_id');
      }
      
      // 5. Navigate
      setPassword('');
      if (userRole === 'Super Admin') {
        navigate("/platform-control", { replace: true });
      } else {
        navigate("/", { replace: true });
      }

    } catch {
      setError(LOGIN_COPY.failure);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F] p-4" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-96 h-96 bg-[#C9A05C]/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 -right-1/4 w-96 h-96 bg-[#C9A05C]/3 rounded-full blur-[120px]" />
      </div>
      <Card className="w-full max-w-md rounded-xl border border-[rgba(201,160,92,0.12)] bg-[#14141B] shadow-2xl overflow-hidden animate-scale-in">
        <CardHeader className="bg-[#0A0A0F] p-8 text-center border-b border-[rgba(201,160,92,0.08)]">
          <div className="mb-4 flex justify-start">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(201,160,92,0.15)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8A8279] transition-all hover:border-[#C9A05C]/40 hover:text-[#C9A05C]"
              aria-label="Back"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
          </div>
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-[#C9A05C]/10 rounded-xl border border-[rgba(201,160,92,0.2)]">
              <Lock className="text-[#C9A05C] w-7 h-7" />
            </div>
          </div>
          <CardTitle className="text-xl tracking-tight text-[#F5F0E8]" style={{ fontFamily: "'Syne', sans-serif" }}>
            Pawn<span className="text-[#C9A05C]">Gold</span>
          </CardTitle>
          <p className="text-[#8A8279] text-[10px] font-semibold uppercase tracking-[0.18em] mt-2">Secure Access Portal</p>
        </CardHeader>

        <CardContent className="p-8 space-y-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2 text-left">
              <label htmlFor="loginEmail" className="block text-[14px] font-semibold text-[#8A8279] ml-1">
                {LOGIN_COPY.email}
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 h-4 w-4 text-[#8A8279]" aria-hidden="true" />
                <input
                  id="loginEmail"
                  name="loginEmail"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-[#1C1C26] border border-[rgba(201,160,92,0.1)] rounded-xl focus:ring-2 focus:ring-[#C9A05C]/30 focus:border-[#C9A05C]/30 outline-none font-medium text-[#F5F0E8] placeholder:text-[#6B655C] transition-all"
                  placeholder="Type your email address"
                  required
                />
              </div>
            </div>

            <PasswordField
              id="loginPassword"
              name="loginPassword"
              label={LOGIN_COPY.password}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              showRequirements={false}
              required
            />

            {error && (
              <div
                role="alert"
                className="p-4 bg-[#D44545]/10 text-[#D44545] text-[14px] font-medium rounded-xl border border-[#D44545]/20 text-left flex items-start gap-2"
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#C9A05C] text-[#0A0A0F] rounded-xl font-semibold uppercase tracking-wider hover:bg-[#E5C88C] transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-50 active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  <span>{LOGIN_COPY.submitting}</span>
                </>
              ) : (
                LOGIN_COPY.submit
              )}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setError(null);
                navigate(LOGIN_COPY.recoveryRoute, { replace: true });
              }}
              className="w-full text-[14px] font-semibold text-[#8A8279] hover:text-[#C9A05C] transition-colors disabled:opacity-50"
            >
              {LOGIN_COPY.recoveryEntry}
            </button>
          </form>
          
          <div className="text-center pt-2">
            <button 
              type="button"
              onClick={() => { localStorage.clear(); window.location.reload(); }}
              className="text-[9px] font-semibold text-[#6B655C] uppercase tracking-widest hover:text-[#C9A05C] transition-colors"
            >
              Reset Session
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}