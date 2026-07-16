import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { getBackendUrl } from '../lib/backendUrl';

const backendUrl = getBackendUrl();

export type KycStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  kycStatus: KycStatus;
  kycLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  requestAuthCode: (
    email: string,
    purpose: 'BIDDER_REGISTRATION' | 'STAFF_ACCOUNT_CREATE',
  ) => Promise<{ error?: string; authCode?: string; message?: string }>;
  signUp: (email: string, password: string, fullName: string, authCode: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshKycStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [kycStatus, setKycStatus] = useState<KycStatus>('NOT_SUBMITTED');
  const [kycLoading, setKycLoading] = useState(false);

  const parseKycStatus = (raw: any): KycStatus => {
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

  const fetchKycStatus = useCallback(async (accessToken: string) => {
    setKycLoading(true);
    try {
      const res = await fetch(`${backendUrl}/auth/kyc/status`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setKycStatus(parseKycStatus(data));
      } else {
        setKycStatus('NOT_SUBMITTED');
      }
    } catch {
      // Silently fail — user stays NOT_SUBMITTED
      setKycStatus('NOT_SUBMITTED');
    } finally {
      setKycLoading(false);
    }
  }, []);

  useEffect(() => {
    // Restore existing session on mount
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.access_token) {
        fetchKycStatus(s.access_token);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.access_token) {
        fetchKycStatus(newSession.access_token);
      } else {
        setKycStatus('NOT_SUBMITTED');
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchKycStatus]);

  const refreshKycStatus = useCallback(async () => {
    if (session?.access_token) {
      await fetchKycStatus(session.access_token);
    }
  }, [session, fetchKycStatus]);

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  };

  const requestAuthCode = async (
    email: string,
    purpose: 'BIDDER_REGISTRATION' | 'STAFF_ACCOUNT_CREATE',
  ): Promise<{ error?: string; authCode?: string; message?: string }> => {
    try {
      const res = await fetch(`${backendUrl}/auth/request-auth-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose }),
      });

      const data = await res.json();
      const payload = data?.data ?? data;
      if (!res.ok) {
        return {
          error:
            data?.message ||
            data?.error ||
            payload?.message ||
            payload?.error ||
            'Failed to request auth code',
        };
      }

      return {
        authCode: payload?.authCode,
        message:
          payload?.warning ||
          payload?.message ||
          'Authentication code sent. Check your email and continue signup.',
      };
    } catch (err: any) {
      return { error: err.message || 'Network error during auth code request' };
    }
  };

  const signUp = async (email: string, password: string, fullName: string, authCode: string): Promise<{ error?: string }> => {
    try {
      const res = await fetch(`${backendUrl}/auth/register-bidder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          auth_code: authCode,
          purpose: 'BIDDER_REGISTRATION',
        }),
      });

      const data = await res.json();
      const payload = data?.data ?? data;

      if (!res.ok) {
        return {
          error:
            data?.message ||
            data?.error ||
            payload?.message ||
            payload?.error ||
            'Registration failed',
        };
      }

      // Auto-login after signup
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) return { error: `Account created, but auto-login failed: ${loginError.message}` };

      return {};
    } catch (err: any) {
      return { error: err.message || 'Network error during registration' };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setKycStatus('NOT_SUBMITTED');
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, kycStatus, kycLoading, signIn, requestAuthCode, signUp, signOut, refreshKycStatus }}>
      {children}
    </AuthContext.Provider>
  );
}
