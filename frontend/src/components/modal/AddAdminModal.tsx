import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { UserPlus, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from '@/lib/toast';
import { getBackendUrl } from '../../lib/backendUrl';
import { PasswordErrorSummary, PasswordField } from '../Auth/PasswordField';
import { getPasswordRuleFailures } from '../Auth/PasswordRequirements';

interface AddAdminModalProps {
  branchId: string;
  branchName: string;
}

const API_BASE_URL = getBackendUrl();

const MODAL_COPY = {
  email: 'Email address',
  authCode: 'Authentication code',
  getCode: 'Get Code',
  grantAdminAccess: 'Grant admin access',
  creating: 'Creating Account...',
  policyNotMet: 'Password requirements are not met.',
  emailRequired: 'Email address is required',
  emailInvalid: 'Please enter a valid email address',
  createFailed: "We couldn't create the admin account. Check the fields below and try again.",
  codeRequestFailed: "We couldn't send the authentication code. Check your connection and try again.",
  branchMissing: 'Branch context not found. Please refresh and try again.',
} as const;

export function AddAdminModal({ branchId, branchName }: AddAdminModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');

  const validateInputs = (): boolean => {
    setValidationError('');
    setPasswordError(null);

    if (!email.trim()) {
      setValidationError(MODAL_COPY.emailRequired);
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setValidationError(MODAL_COPY.emailInvalid);
      return false;
    }

    if (getPasswordRuleFailures(password).length > 0) {
      setPasswordError(MODAL_COPY.policyNotMet);
      setValidationError(MODAL_COPY.policyNotMet);
      return false;
    }

    if (!authCode.trim()) {
      setValidationError('Authentication code is required');
      return false;
    }

    return true;
  };

  const handleRequestAuthCode = async () => {
    setValidationError('');

    if (!email.trim()) {
      setValidationError('Enter admin email first to request auth code');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/request-auth-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          purpose: 'STAFF_ACCOUNT_CREATE',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.warn('[AddAdminModal] Auth code request rejected', response.status, data?.error);
        toast.error(MODAL_COPY.codeRequestFailed);
        return;
      }

      toast.success('Authentication code sent to your email.');
    } catch (err: unknown) {
      console.warn('[AddAdminModal] Auth code request failed', err);
      toast.error(MODAL_COPY.codeRequestFailed);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateInputs()) {
      return;
    }

    if (!branchId) {
      toast.error(MODAL_COPY.branchMissing);
      return;
    }

    setLoading(true);

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const response = await fetch(`${API_BASE_URL}/auth/create-branch-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { 'Authorization': `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          role: 'BRANCH_ADMIN',
          pawnshop_id: branchId,
          full_name: `${branchName} Admin`,
          auth_code: authCode.trim(),
          purpose: 'STAFF_ACCOUNT_CREATE',
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        console.warn('[AddAdminModal] Admin provisioning rejected', response.status, data?.error);
        toast.error(MODAL_COPY.createFailed, { duration: 5000 });
        return;
      }

      toast.success(`Admin account created successfully for ${branchName}`, { duration: 5000 });

      setIsOpen(false);
      setEmail('');
      setPassword('');
      setAuthCode('');
      setPasswordError(null);
      setValidationError('');
    } catch (err: unknown) {
      console.warn('[AddAdminModal] Admin provisioning failed', err);
      toast.error(MODAL_COPY.createFailed, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#C9A05C] hover:bg-[#E5C88C] text-white font-bold py-5 px-6 rounded-2xl flex gap-2 transition-all shadow-lg shadow-indigo-200">
          <UserPlus size={18} /> Add Admin
        </Button>
      </DialogTrigger>
       
      <DialogContent className="sm:max-w-[450px] rounded-[32px] p-8 border-none shadow-2xl bg-[#14141B] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-6">
          <div className="w-12 h-12 bg-[#C9A05C]/10 text-[#C9A05C] rounded-2xl flex items-center justify-center mb-4">
            <ShieldCheck size={28} />
          </div>
          <DialogTitle className="text-2xl font-black uppercase italic tracking-tight text-[#F5F0E8]">
            Internal <span className="text-[#C9A05C]">Provisioning</span>
          </DialogTitle>
          <p className="text-[#8A8279] text-sm font-medium">
            Creating administrative access for <span className="text-[#F5F0E8] font-bold underline">{branchName}</span>.
          </p>
        </DialogHeader>

        <form onSubmit={handleCreateAdmin} className="space-y-5">
          {validationError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <span className="text-red-600 font-bold text-lg flex-shrink-0">!</span>
              <p className="text-red-700 text-sm font-medium">{validationError}</p>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="branchAdminModalEmail" className="text-[10px] font-black uppercase tracking-widest text-[#8A8279] flex items-center gap-2">
              <Mail size={12} className="text-[#C9A05C]" aria-hidden="true" /> {MODAL_COPY.email}
            </label>
            <Input
              id="branchAdminModalEmail"
              name="branchAdminModalEmail"
              type="email"
              autoComplete="off"
              placeholder="admin@branch.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setValidationError('');
              }}
              disabled={loading}
              className="p-4 h-auto rounded-xl border-[rgba(201,160,92,0.08)] bg-[#1C1C26] font-medium focus:bg-[#14141B] transition-colors disabled:opacity-50"
            />
          </div>

          <PasswordField
            id="branchAdminModalPassword"
            name="branchAdminModalPassword"
            label="New password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setValidationError('');
            }}
            helperText="Use a private password you do not use elsewhere."
            error={passwordError ?? undefined}
            errorSummaryId="branch-admin-modal-error-summary"
            autoComplete="new-password"
            disabled={loading}
            required
          />

          <div className="space-y-2">
            <label htmlFor="branchAdminModalAuthCode" className="text-[10px] font-black uppercase tracking-widest text-[#8A8279] flex items-center gap-2">
              {MODAL_COPY.authCode}
            </label>
            <div className="flex gap-2">
              <Input
                id="branchAdminModalAuthCode"
                name="branchAdminModalAuthCode"
                type="text"
                autoComplete="one-time-code"
                placeholder="Enter code"
                value={authCode}
                onChange={(e) => {
                  setAuthCode(e.target.value);
                  setValidationError('');
                }}
                disabled={loading}
                className="p-4 h-auto rounded-xl border-[rgba(201,160,92,0.08)] bg-[#1C1C26] font-medium focus:bg-[#14141B] transition-colors disabled:opacity-50"
              />
              <Button
                type="button"
                onClick={handleRequestAuthCode}
                disabled={loading}
                className="bg-[#222228] hover:bg-slate-300 text-[#F5F0E8] font-black uppercase tracking-widest px-4 rounded-xl"
              >
                {MODAL_COPY.getCode}
              </Button>
            </div>
          </div>

          {validationError && (
            <PasswordErrorSummary
              id="branch-admin-modal-error-summary"
              message={validationError}
              fieldId={passwordError ? 'branchAdminModalPassword' : 'branchAdminModalEmail'}
            />
          )}

          <div className="pt-2">
            <Button 
              type="submit" 
              disabled={loading || !email.trim() || !password.trim() || !authCode.trim()}
              className="w-full bg-[#C9A05C] hover:bg-[#E5C88C] text-white font-black uppercase tracking-widest py-6 px-4 rounded-xl transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="animate-spin" size={18} /> 
                  {MODAL_COPY.creating}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <ShieldCheck size={18} />
                  {MODAL_COPY.grantAdminAccess}
                </span>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
