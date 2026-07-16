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
import { UserPlus, Loader2, Mail, Lock, ShieldCheck } from "lucide-react";
import { toast } from '@/lib/toast';
import { getBackendUrl } from '../../lib/backendUrl';

interface AddAdminModalProps {
  branchId: string;
  branchName: string;
}

const API_BASE_URL = getBackendUrl();

export function AddAdminModal({ branchId, branchName }: AddAdminModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [validationError, setValidationError] = useState('');

  const validateInputs = (): boolean => {
    setValidationError('');

    if (!email.trim()) {
      setValidationError('Email address is required');
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setValidationError('Please enter a valid email address');
      return false;
    }

    if (!password.trim()) {
      setValidationError('Password is required');
      return false;
    }

    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters');
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
        throw new Error(data?.error || data?.message || 'Failed to request authentication code');
      }

      toast.success('Authentication code sent to your email.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateInputs()) {
      return;
    }

    if (!branchId) {
      toast.error('Branch context not found. Please refresh and try again.');
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

      if (!response.ok) {
        console.error('[AddAdminModal] API Error Response:', { status: response.status, data });
        const errorMsg = data.error || data.message || `Server error (HTTP ${response.status})`;
        toast.error(errorMsg, { duration: 5000 });
        return;
      }

      if (!data.success) {
        console.error('[AddAdminModal] Success=false Response:', data);
        const errorMsg = data.error || data.message || 'Failed to create admin account';
        toast.error(errorMsg, { duration: 5000 });
        return;
      }

      toast.success(`âœ“ Admin account created successfully for ${branchName}`, { duration: 5000 });


      // Clear form and close dialog
      setIsOpen(false);
      setEmail('');
      setPassword('');
      setAuthCode('');
      setValidationError('');

      // Optional: Reload users list or trigger a callback
    } catch (err: unknown) {
      console.error('[AddAdminModal] Network/Fatal Error:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.error(errorMsg, { duration: 6000 });
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
      
      <DialogContent className="sm:max-w-[450px] rounded-[32px] p-8 border-none shadow-2xl bg-[#14141B]">
        <DialogHeader className="mb-6">
          <div className="w-12 h-12 bg-[#C9A05C]/10 text-[#C9A05C] rounded-2xl flex items-center justify-center mb-4">
            <ShieldCheck size={28} />
          </div>
          <DialogTitle className="text-2xl font-black uppercase italic tracking-tight text-[#EAE2D6]">
            Internal <span className="text-[#C9A05C]">Provisioning</span>
          </DialogTitle>
          <p className="text-[#6B655C] text-sm font-medium">
            Creating administrative access for <span className="text-[#EAE2D6] font-bold underline">{branchName}</span>.
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
            <label className="text-[10px] font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <Mail size={12} className="text-[#C9A05C]" /> Email Address
            </label>
            <Input 
              type="email" 
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

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              <Lock size={12} className="text-[#C9A05C]" /> Password (Min. 8 characters)
            </label>
            <Input 
              type="password" 
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" 
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setValidationError('');
              }}
              disabled={loading}
              className="p-4 h-auto rounded-xl border-[rgba(201,160,92,0.08)] bg-[#1C1C26] font-medium focus:bg-[#14141B] transition-colors disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#6B655C] flex items-center gap-2">
              Authentication Code
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
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
                className="bg-[#222228] hover:bg-slate-300 text-[#EAE2D6] font-black uppercase tracking-widest px-4 rounded-xl"
              >
                Get Code
              </Button>
            </div>
          </div>

          <div className="pt-2">
            <Button 
              type="submit" 
              disabled={loading || !email.trim() || !password.trim() || !authCode.trim()}
              className="w-full bg-[#C9A05C] hover:bg-[#E5C88C] text-white font-black uppercase tracking-widest py-6 px-4 rounded-xl transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="animate-spin" size={18} /> 
                  Creating Account...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <ShieldCheck size={18} />
                  Grant Admin Privileges
                </span>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}