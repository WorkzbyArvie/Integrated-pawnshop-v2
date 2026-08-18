import React, { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import { 
  Users, 
  Wallet, 
  Gavel, 
  ShieldCheck, 
  Settings2,
  Package,
  BellRing,
  BrainCircuit,
  Users2,
  Undo2,
  ShieldAlert,
  X,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Crown,
  Palette,
  FileText,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import api from '../../lib/apiClient';

interface SystemSettingsProps {
  config: {
    vault_enabled: boolean;
    finance_enabled: boolean;
    hr_enabled: boolean;
    auction_enabled: boolean;
    decision_enabled: boolean;
    crm_enabled: boolean;
    alerts_enabled: boolean;
  };
  setConfig: React.Dispatch<React.SetStateAction<any>>;
  userRole: string;
  branchId?: string | null;
  onBrandingUpdated?: (branding: BrandingPayload) => void;
}

type BrandingPayload = {
  pawnshopId: string | null;
  pawnshopName: string | null;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  customBrandingEnabled: boolean;
};

const DEFAULT_BRANDING: BrandingPayload = {
  pawnshopId: null,
  pawnshopName: null,
  displayName: 'PawnGold',
  logoUrl: null,
  primaryColor: '#D4AF37',
  secondaryColor: '#141416',
  customBrandingEnabled: false,
};

export function SystemSettings({ config, setConfig, userRole, branchId, onBrandingUpdated }: SystemSettingsProps) {
  // State for Confirmation Workflow
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [globalConfig, setGlobalConfig] = useState<Record<string, boolean> | null>(null);
  const [branding, setBranding] = useState<BrandingPayload>(DEFAULT_BRANDING);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [redemptionThreshold, setRedemptionThreshold] = useState<number>(50000);
  const [contractTerms, setContractTerms] = useState('');
  const [contractResponsibilities, setContractResponsibilities] = useState('');
  const [savingContractTerms, setSavingContractTerms] = useState(false);
  
  const normalizedRole = (userRole || '').toUpperCase().replace(/[_\s]/g, '');
  const isSuperAdmin = normalizedRole === 'SUPERADMIN' || normalizedRole === 'SUPER';

  // Load settings from database on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (isSuperAdmin) {
          // Super Admin: load global_overrides from any pawnshop (they're the same on all)
          const { data, error } = await supabase
            .from('pawnshops')
            .select('settings')
            .limit(1)
            .single();
          
          if (error) {
            console.error('Error loading settings:', error);
            return;
          }

          if (data?.settings) {
            setRedemptionThreshold(Number(data.settings.redemptionApprovalThreshold) || 50000);
            const globalOverrides = data.settings.global_overrides;
            if (globalOverrides) {
              setConfig((prev: any) => ({ ...prev, ...globalOverrides }));
            } else {
              // Backward compat: no global_overrides yet, use flat settings
              const { global_overrides: _, ...flat } = data.settings;
              setConfig((prev: any) => ({ ...prev, ...flat }));
            }
          }
        } else if (branchId) {
          // Branch Admin: load own branch settings (single query)
          const { data, error } = await supabase
            .from('pawnshops')
            .select('settings')
            .eq('id', branchId)
            .single();
          
          if (error) {
            console.error('Error loading branch settings:', error);
            return;
          }

          if (data?.settings) {
            const { global_overrides, redemptionApprovalThreshold, ...localSettings } = data.settings;
            setRedemptionThreshold(Number(redemptionApprovalThreshold) || 50000);
            setContractTerms(String(data.settings.contractTermsAndConditions || ''));
            setContractResponsibilities(String(data.settings.contractPawnshopResponsibilities || ''));
            // Set local config (what the Branch Admin sees/edits)
            setConfig((prev: any) => ({ ...prev, ...localSettings }));
            // Set global overrides for the "Restricted" badge / grey-out check
            if (global_overrides) {
              setGlobalConfig(global_overrides);
            }
          }
        }
      } catch (error) {
        console.error('Error in loadSettings:', error);
      }
    };
    
    loadSettings();
  }, [isSuperAdmin, branchId, setConfig]);

  useEffect(() => {
    const loadBranding = async () => {
      if (isSuperAdmin || !branchId) {
        setBranding(DEFAULT_BRANDING);
        return;
      }

      setLoadingBranding(true);
      try {
        const response = await api.get<any>('/tenant-governance/branding', {
          pawnshopId: branchId,
        });
        const payload = response?.branding || response || {};
        setBranding({
          pawnshopId: payload.pawnshopId || branchId,
          pawnshopName: payload.pawnshopName || null,
          displayName: payload.displayName || payload.pawnshopName || 'PawnGold',
          logoUrl: payload.logoUrl || null,
          primaryColor: payload.primaryColor || '#D4AF37',
          secondaryColor: payload.secondaryColor || '#141416',
          customBrandingEnabled: Boolean(payload.customBrandingEnabled),
        });
      } catch {
        setBranding(DEFAULT_BRANDING);
      } finally {
        setLoadingBranding(false);
      }
    };

    void loadBranding();
  }, [isSuperAdmin, branchId]);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  // HELPER: Determine if a feature is globally disabled by Super Admin
  const isGloballyOverridden = (id: string) => {
    if (isSuperAdmin) return false;
    if (globalConfig) {
      return globalConfig[id] === false;
    }
    return false;
  };

  const featureList = [
    { id: 'vault_enabled', name: 'Inventory Vault', description: 'Secured asset repository and automated collateral tracking system.', icon: Package, category: 'Operations' },
    { id: 'finance_enabled', name: 'Finance & Treasury', description: 'Monitor liquidity, interest accruals, and branch cashflow.', icon: Wallet, category: 'Management' },
    { id: 'crm_enabled', name: 'Customer CRM', description: 'Advanced KYC, risk scoring, and customer transaction history.', icon: Users2, category: 'Management' },
    { id: 'hr_enabled', name: 'Staff Matrix', description: 'Manage employee performance, permissions, and attendance.', icon: Users, category: 'Management' },
    { id: 'auction_enabled', name: 'Auction House', description: 'Liquidation engine for unredeemed items with digital bidding.', icon: Gavel, category: 'Operations' },
    { id: 'decision_enabled', name: 'Decision Support', description: 'Algorithmic appraisal assistance and market volatility protection.', icon: BrainCircuit, category: 'Security' },
    { id: 'alerts_enabled', name: 'Auto-Reminders', description: 'Automated SMS and Email alerts for expiring pawn tickets.', icon: BellRing, category: 'Security' },
  ];

  const toggleFeature = (id: string) => {
    if (isGloballyOverridden(id)) return;
    setConfig((prev: any) => ({ ...prev, [id]: !prev[id] }));
  };

  // ASYNC SAVE HANDLER
  const handleConfirmSave = async () => {
    setIsSaving(true);

    const threshold = Number(redemptionThreshold);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      setIsSaving(false);
      await Swal.fire({
        icon: 'warning',
        title: 'Invalid Redemption Threshold',
        text: 'Enter a valid amount greater than zero.',
        confirmButtonColor: '#ef4444',
      });
      return;
    }

    try {
      if (isSuperAdmin) {
        // â”€â”€ Super Admin: write global_overrides to ALL pawnshops â”€â”€
        // Preserves each branch's local settings
        const { data: pawnshops, error: fetchError } = await supabase
          .from('pawnshops')
          .select('id, settings');
        
        if (fetchError) throw fetchError;

        if (pawnshops && pawnshops.length > 0) {
          for (const shop of pawnshops) {
            const currentSettings = shop.settings || {};
            const updatedSettings = {
              ...currentSettings,
              global_overrides: { ...config },
            };
            await api.patch(`/tenant-governance/pawnshops/${shop.id}/settings`, { settings: updatedSettings });
          }
        }
      } else if (branchId) {
        // â”€â”€ Branch Admin: write local settings to this pawnshop only â”€â”€
        // Preserves global_overrides set by Super Admin
        const { data: current, error: readError } = await supabase
          .from('pawnshops')
          .select('settings')
          .eq('id', branchId)
          .single();

        if (readError) throw readError;

        const currentSettings = current?.settings || {};

        // Enforce global overrides: force-off any feature the super admin has disabled
        const sanitizedConfig = { ...config };
        if (globalConfig) {
          for (const key of Object.keys(sanitizedConfig)) {
            if (globalConfig[key] === false) {
              (sanitizedConfig as any)[key] = false;
            }
          }
        }

        // Merge: update local keys, preserve global_overrides
        const updatedSettings = {
          ...currentSettings,
          ...sanitizedConfig,
          redemptionApprovalThreshold: threshold,
          global_overrides: currentSettings.global_overrides || {},
        };

        await api.patch(`/tenant-governance/pawnshops/${branchId}/settings`, { settings: updatedSettings });
        setConfig((prev: any) => ({ ...prev, ...sanitizedConfig }));
      }

      setIsSaving(false);
      setIsModalOpen(false);
      setShowToast(true);
    } catch (error) {
      console.error('Error saving settings:', error);
      setIsSaving(false);
      setIsModalOpen(false);
    }
  };

  const handleBrandingChange = (field: keyof BrandingPayload, value: string) => {
    setBranding((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveBranding = async () => {
    if (isSuperAdmin || !branchId) return;
    if (!branding.customBrandingEnabled) {
      await Swal.fire({
        icon: 'info',
        title: 'Enterprise Plan Required',
        text: 'Custom branding is available only on the Enterprise plan.',
        confirmButtonColor: '#4f46e5',
      });
      return;
    }

    setSavingBranding(true);
    try {
      const response = await api.patch<any>('/tenant-governance/branding', {
        pawnshopId: branchId,
        displayName: branding.displayName,
        logoUrl: branding.logoUrl || '',
        primaryColor: branding.primaryColor,
        secondaryColor: branding.secondaryColor,
      });

      const payload = response?.branding || response || {};
      const updatedBranding: BrandingPayload = {
        pawnshopId: payload.pawnshopId || branchId || null,
        pawnshopName: payload.pawnshopName || branding.pawnshopName || null,
        displayName: payload.displayName || branding.displayName,
        logoUrl: payload.logoUrl || null,
        primaryColor: payload.primaryColor || branding.primaryColor,
        secondaryColor: payload.secondaryColor || branding.secondaryColor,
        customBrandingEnabled: Boolean(payload.customBrandingEnabled),
      };

      setBranding(() => ({
        ...updatedBranding,
      }));

      onBrandingUpdated?.(updatedBranding);

      await Swal.fire({
        icon: 'success',
        title: 'Branding Saved',
        text: 'Your custom branding has been updated.',
        timer: 2200,
        showConfirmButton: false,
      });
    } catch (error: any) {
      await Swal.fire({
        icon: 'error',
        title: 'Branding Update Failed',
        text: error?.message || 'Unable to update custom branding right now.',
        confirmButtonColor: '#ef4444',
      });
    } finally {
      setSavingBranding(false);
    }
  };

  const handleSaveContractTerms = async () => {
    if (!branchId) return;
    setSavingContractTerms(true);
    try {
      await api.patch(`/tenant-governance/pawnshops/${branchId}/contract-terms`, {
        termsAndConditions: contractTerms,
        pawnshopResponsibilities: contractResponsibilities,
      });
      setShowToast(true);
    } catch (error) {
      console.error('Error saving contract terms:', error);
      await Swal.fire({
        icon: 'error',
        title: 'Save Failed',
        text: 'Unable to save contract terms right now.',
        confirmButtonColor: '#ef4444',
      });
    } finally {
      setSavingContractTerms(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000 font-inter pb-20 text-left relative">
      
      {/* SUCCESS TOAST */}
      {showToast && (
        <div className="fixed top-8 right-8 z-[200] animate-in slide-in-from-right-10 fade-in duration-500">
          <div className="bg-slate-900 border border-slate-800 text-white px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-4">
            <div className="bg-emerald-500/20 p-2 rounded-xl">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-widest leading-none">Changes Saved</p>
              <p className="text-[10px] text-[#6B655C] mt-1 font-medium">System configuration synchronized.</p>
            </div>
            <button onClick={() => setShowToast(false)} className="ml-4 text-[#6B655C] hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-black text-[#EAE2D6] tracking-tight uppercase italic leading-none">
            {isSuperAdmin ? 'Platform Control' : 'Branch Settings'}
          </h2>
          <p className="text-[#6B655C] font-medium mt-2">
            {isSuperAdmin 
              ? 'Manage global feature availability for all tenants.' 
              : 'Configure active modules for this specific branch.'}
          </p>
        </div>
        <div className={`p-4 rounded-2xl border shadow-sm group hover:rotate-90 transition-transform duration-500 ${
          isSuperAdmin ? 'bg-[#C9A05C]/10 border-[rgba(201,160,92,0.15)]' : 'bg-[#14141B] border-[rgba(201,160,92,0.08)]'
        }`}>
          {isSuperAdmin ? <ShieldAlert className="w-6 h-6 text-[#C9A05C]" /> : <Settings2 className="w-6 h-6 text-[#C9A05C]" />}
        </div>
      </div>

      {/* SUPER ADMIN BANNER */}
      {isSuperAdmin && (
        <div className="bg-[#C9A05C] rounded-[2rem] p-6 text-white flex items-center gap-6 shadow-xl shadow-indigo-200">
          <div className="bg-white/20 p-4 rounded-2xl">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <div>
            <h4 className="font-black uppercase tracking-widest text-sm">Global Master Switches</h4>
            <p className="text-[#E5C88C] text-xs mt-1">
              Changes made here are <span className="underline decoration-[#C9A05C]">authoritative</span>.
            </p>
          </div>
        </div>
      )}

      {/* FEATURE GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {featureList.map((feature) => {
          const globalDisabled = isGloballyOverridden(feature.id);
          const isEnabled = globalDisabled ? false : (config as any)[feature.id];
          
          return (
            <div 
              key={feature.id}
              className={`group bg-[#14141B] rounded-[2.8rem] p-8 border-2 transition-all duration-500 shadow-xl ${
                globalDisabled ? 'opacity-50 grayscale-[0.4]' : ''
              } ${isEnabled ? (isSuperAdmin ? 'border-indigo-500/10' : 'border-blue-500/10') : 'border-transparent opacity-70'}`}
            >
              <div className="flex items-center justify-between mb-6">
                <div className={`p-4 rounded-2xl transition-all duration-500 ${
                  isEnabled ? (isSuperAdmin ? 'bg-[#C9A05C] shadow-indigo-600/20' : 'bg-blue-600 shadow-blue-600/20') : 'bg-[#1C1C26] text-[#6B655C]'
                } text-white shadow-lg`}>
                  <feature.icon className="w-7 h-7" />
                </div>
                
                <button
                  onClick={() => toggleFeature(feature.id)}
                  disabled={globalDisabled}
                  className={`w-14 h-8 rounded-full transition-all duration-300 relative p-1 outline-none ${
                    globalDisabled ? 'bg-slate-300 cursor-not-allowed' : (isEnabled ? (isSuperAdmin ? 'bg-[#C9A05C]' : 'bg-blue-600') : 'bg-[#222228]')
                  }`}
                >
                  <div className={`w-6 h-6 bg-[#14141B] rounded-full shadow-lg transition-transform duration-300 ${isEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${isEnabled ? (isSuperAdmin ? 'text-[#C9A05C]' : 'text-[#C9A05C]') : 'text-[#6B655C]'}`}>
                    {feature.category}
                  </span>
                  {globalDisabled && (
                    <span className="bg-rose-50 text-rose-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter flex items-center gap-1">
                      <ShieldAlert size={8} /> Restricted
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-black text-[#EAE2D6] mb-2">{feature.name}</h3>
                <p className="text-sm text-[#6B655C] font-medium leading-relaxed">{feature.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-[#14141B] rounded-[2.8rem] p-8 border-2 border-[rgba(201,160,92,0.08)] shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A05C]">Redemption Policy</p>
            <h3 className="text-2xl font-black text-[#EAE2D6] mt-1 flex items-center gap-2">
              <Undo2 className="w-6 h-6 text-[#C9A05C]" />
              Redemption Approval Threshold
            </h3>
            <p className="text-sm text-[#6B655C] mt-2">
              Redemption requests above this amount require owner approval in the Approval Queue.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 max-w-md">
          <span className="text-lg font-black text-[#C9A05C]">PHP</span>
          <input
            type="number"
            min={1}
            step={1}
            value={redemptionThreshold}
            onChange={(event) => setRedemptionThreshold(Number(event.target.value))}
            className="w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-semibold text-[#EAE2D6]"
            placeholder="50000"
          />
        </div>
      </div>

      {!isSuperAdmin && branchId && (
        <div className="bg-[#14141B] rounded-[2.8rem] p-8 border-2 border-[rgba(201,160,92,0.08)] shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A05C]">Contract Policy</p>
              <h3 className="text-2xl font-black text-[#EAE2D6] mt-1 flex items-center gap-2">
                <FileText className="w-6 h-6 text-[#C9A05C]" />
                Contract Terms & Responsibilities
              </h3>
              <p className="text-sm text-[#6B655C] mt-2">
                These appear on every loan contract your pawnshop generates. If you set Terms and Conditions, they replace the standard text. Write one item per line.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-[#6B655C]">Terms and Conditions</label>
              <textarea
                value={contractTerms}
                onChange={(event) => setContractTerms(event.target.value)}
                rows={9}
                placeholder={'1. The Pawnee acknowledges receipt of the loan amount.\n2. Interest accrues monthly at the rate stated on the contract.\n3. The Pawnshop reserves the right to sell the collateral if the loan is not redeemed within the term and grace period.'}
                className="mt-2 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-medium text-[#EAE2D6] bg-[#1C1C26] focus:outline-none focus:border-[#C9A05C]"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-[#6B655C]">Pawnshop Responsibilities</label>
              <textarea
                value={contractResponsibilities}
                onChange={(event) => setContractResponsibilities(event.target.value)}
                rows={6}
                placeholder={'The Pawnshop shall safely store the collateral for the full term of the loan.\nThe Pawnshop shall release the collateral upon full payment of principal and interest.\nThe Pawnshop shall issue a receipt for every payment received.'}
                className="mt-2 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-medium text-[#EAE2D6] bg-[#1C1C26] focus:outline-none focus:border-[#C9A05C]"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => void handleSaveContractTerms()}
                disabled={savingContractTerms}
                className="px-6 py-3 rounded-2xl bg-[#C9A05C] text-white text-xs font-black uppercase tracking-widest hover:bg-[#C9A05C]/80 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {savingContractTerms && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Contract Terms
              </button>
            </div>
          </div>
        </div>
      )}

      {!isSuperAdmin && (
        <div className="bg-[#14141B] rounded-[2.8rem] p-8 border-2 border-[rgba(201,160,92,0.08)] shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A05C]">Enterprise Feature</p>
              <h3 className="text-2xl font-black text-[#EAE2D6] mt-1 flex items-center gap-2">
                <Palette className="w-6 h-6 text-[#C9A05C]" />
                Custom Branding
              </h3>
              <p className="text-sm text-[#6B655C] mt-2">
                Set your sidebar name, logo, and brand colors. This applies to your pawnshop workspace.
              </p>
            </div>
            {!branding.customBrandingEnabled && (
              <span className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-200 px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider">
                <Crown className="w-4 h-4" />
                Upgrade to Enterprise
              </span>
            )}
          </div>

          {loadingBranding ? (
            <div className="flex items-center gap-3 text-[#6B655C]">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading branding configuration...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label className="text-xs font-black uppercase tracking-wider text-[#6B655C]">Display Name</label>
                  <input
                    type="text"
                    value={branding.displayName}
                    onChange={(event) => handleBrandingChange('displayName', event.target.value)}
                    maxLength={60}
                    disabled={!branding.customBrandingEnabled || savingBranding}
                    className="mt-2 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-semibold text-[#EAE2D6] disabled:bg-[#1C1C26] disabled:text-[#6B655C]"
                    placeholder="Your pawnshop display name"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-black uppercase tracking-wider text-[#6B655C]">Logo URL</label>
                  <input
                    type="url"
                    value={branding.logoUrl || ''}
                    onChange={(event) => handleBrandingChange('logoUrl', event.target.value)}
                    disabled={!branding.customBrandingEnabled || savingBranding}
                    className="mt-2 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-semibold text-[#EAE2D6] disabled:bg-[#1C1C26] disabled:text-[#6B655C]"
                    placeholder="https://example.com/logo.png"
                  />
                </div>

                <div>
                  <label className="text-xs font-black uppercase tracking-wider text-[#6B655C]">Primary Color</label>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[rgba(201,160,92,0.12)] px-3 py-2">
                    <input
                      type="color"
                      value={branding.primaryColor}
                      onChange={(event) => handleBrandingChange('primaryColor', event.target.value)}
                      disabled={!branding.customBrandingEnabled || savingBranding}
                      className="h-10 w-14 cursor-pointer rounded-xl border-0 bg-transparent disabled:cursor-not-allowed"
                    />
                    <span className="text-xs font-black text-[#999186] uppercase tracking-widest">{branding.primaryColor}</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-black uppercase tracking-wider text-[#6B655C]">Secondary Color</label>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[rgba(201,160,92,0.12)] px-3 py-2">
                    <input
                      type="color"
                      value={branding.secondaryColor}
                      onChange={(event) => handleBrandingChange('secondaryColor', event.target.value)}
                      disabled={!branding.customBrandingEnabled || savingBranding}
                      className="h-10 w-14 cursor-pointer rounded-xl border-0 bg-transparent disabled:cursor-not-allowed"
                    />
                    <span className="text-xs font-black text-[#999186] uppercase tracking-widest">{branding.secondaryColor}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-[rgba(201,160,92,0.12)] p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl" style={{ backgroundColor: branding.primaryColor }} />
                  <div>
                    <p className="text-sm font-black text-[#EAE2D6]">{branding.displayName || branding.pawnshopName || 'PawnGold'}</p>
                    <p className="text-xs text-[#6B655C]">Sidebar preview colors</p>
                  </div>
                </div>
                <button
                  onClick={() => void handleSaveBranding()}
                  disabled={!branding.customBrandingEnabled || savingBranding}
                  className="px-6 py-3 rounded-2xl bg-[#C9A05C] text-white text-xs font-black uppercase tracking-widest hover:bg-[#C9A05C]/80 disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {savingBranding && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Branding
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* PERSISTENCE FOOTER */}
      <div className={`rounded-[2.5rem] p-8 text-white flex items-center justify-between overflow-hidden relative shadow-2xl transition-colors duration-500 ${
        isSuperAdmin ? 'bg-indigo-950' : 'bg-slate-900'
      }`}>
        <div className="relative z-10">
          <h3 className="text-xl font-black mb-1 italic uppercase tracking-tighter">
            Save {isSuperAdmin ? 'Global' : 'Branch'} Changes?
          </h3>
          <p className="text-[#6B655C] text-sm font-medium italic">Confirmation required to proceed.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className={`relative z-10 px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 shadow-lg ${
          isSuperAdmin ? 'bg-[#C9A05C] hover:bg-[#C9A05C]/80 shadow-indigo-600/20' : 'bg-blue-600 hover:bg-[#C9A05C]/100 shadow-blue-600/20'
        }`}>
          Apply Changes
        </button>
      </div>

      {/* CONFIRMATION MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" 
            onClick={() => !isSaving && setIsModalOpen(false)} 
          />
          
          <div className="relative bg-[#14141B] rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8">
              <div className="flex justify-between items-start mb-6">
                <div className={`p-4 rounded-2xl ${isSuperAdmin ? 'bg-[#C9A05C]/15 text-[#C9A05C]' : 'bg-[#C9A05C]/15 text-[#C9A05C]'}`}>
                  {isSaving ? <Loader2 className="w-8 h-8 animate-spin" /> : <AlertTriangle className="w-8 h-8" />}
                </div>
                {!isSaving && (
                  <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-[#1C1C26] rounded-xl transition-colors">
                    <X className="w-6 h-6 text-[#6B655C]" />
                  </button>
                )}
              </div>

              <h2 className="text-2xl font-black text-[#EAE2D6] uppercase italic tracking-tight mb-2">
                {isSaving ? 'Processing...' : 'Confirm Update'}
              </h2>
              <p className="text-[#6B655C] font-medium leading-relaxed mb-8">
                {isSaving 
                  ? "Writing configuration to the system registry. Please do not close this window."
                  : "Are you sure you want to proceed? These changes will take effect immediately across your terminal."}
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleConfirmSave}
                  disabled={isSaving}
                  className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs text-white shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${
                    isSuperAdmin ? 'bg-[#C9A05C] hover:bg-[#C9A05C]/80' : 'bg-blue-600 hover:bg-[#C9A05C]/100'
                  } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isSaving ? 'Synchronizing...' : 'Yes, Apply Changes'}
                </button>
                {!isSaving && (
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs text-[#6B655C] hover:text-[#999186] hover:bg-[#1C1C26] transition-all"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}