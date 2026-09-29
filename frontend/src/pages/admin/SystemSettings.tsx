import React, { useState, useEffect, useMemo } from 'react';
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
  Loader2,
  CheckCircle2,
  Crown,
  Palette,
  FileText,
  MapPin,
} from 'lucide-react';
import api from '../../lib/apiClient';
import { LocationPicker } from '../../components/LocationPicker';

/** Shape returned by the tenant-governance system-config endpoints. */
interface SystemConfigResponse {
  pawnshopId: string;
  settings: Record<string, any>;
  globalOverrides: Record<string, boolean>;
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}

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

type SectionKey = 'features' | 'contract' | 'location' | 'branding';

const SECTION_ORDER: SectionKey[] = ['features', 'contract', 'location', 'branding'];

const SECTION_LABELS: Record<SectionKey, string> = {
  features: 'feature toggles and redemption threshold',
  contract: 'contract terms',
  location: 'map location',
  branding: 'branding',
};

// Exactly the keys the snapshot carries. Declaring this as the wider
// `keyof BrandingPayload` would let a field name index a snapshot that does
// not hold it.
type ComparedBrandingField = 'displayName' | 'logoUrl' | 'primaryColor' | 'secondaryColor';

const BRANDING_COMPARED_FIELDS: ComparedBrandingField[] = [
  'displayName',
  'logoUrl',
  'primaryColor',
  'secondaryColor',
];

type SavedSnapshot = {
  config: Record<string, boolean>;
  redemptionThreshold: number;
  contractTerms: string;
  contractResponsibilities: string;
  pawnshopLat: number | null;
  pawnshopLng: number | null;
  pawnshopAddress: string;
  branding: Pick<BrandingPayload, ComparedBrandingField>;
};

/**
 * Per-section save state, shown in place of the three buttons that used to sit
 * inside each section. Those buttons wrote to the server on click with no
 * relationship to the footer action, so the page could not say what was still
 * outstanding.
 */
function SectionSaveState({ dirty, saving }: { dirty: boolean; saving?: boolean }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#8A8279]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Saving
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Unsaved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#6E655A]">
      <CheckCircle2 className="w-3.5 h-3.5" />
      Saved
    </span>
  );
}

export function SystemSettings({ config, setConfig, userRole, branchId, onBrandingUpdated }: SystemSettingsProps) {
  // State for Confirmation Workflow
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
  const [pawnshopLat, setPawnshopLat] = useState<number | null>(null);
  const [pawnshopLng, setPawnshopLng] = useState<number | null>(null);
  const [pawnshopAddress, setPawnshopAddress] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Last values known to be on the server. Every unsaved indicator is a diff
  // against this rather than a hand-maintained flag.
  const [savedSnapshot, setSavedSnapshot] = useState<SavedSnapshot | null>(null);
  
  const normalizedRole = (userRole || '').toUpperCase().replace(/[_\s]/g, '');
  const isSuperAdmin = normalizedRole === 'SUPERADMIN' || normalizedRole === 'SUPER';

  // Load settings from database on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Both branches go through the backend. The direct `pawnshops` reads they
        // replace carried no tenant filter and were gated only on a client-side
        // role string, so any browser could ask for another shop's settings.
        if (isSuperAdmin) {
          // The platform view fans out across shops, so it is served by the
          // existing platform directory endpoint plus a per-shop settings read.
          const shops = await api.get<Array<{ id: string; name?: string }>>('/pawnshops');
          const first = shops?.[0];

          if (first?.id) {
            const data = await api.get<SystemConfigResponse>(
              `/tenant-governance/pawnshops/${first.id}/settings`,
            );

            if (data?.settings) {
              setRedemptionThreshold(Number(data.settings.redemptionApprovalThreshold) || 50000);
              if (data.globalOverrides && Object.keys(data.globalOverrides).length > 0) {
                setConfig((prev: any) => ({ ...prev, ...data.globalOverrides }));
              } else {
                // Backward compat: no global_overrides yet, use flat settings
                setConfig((prev: any) => ({ ...prev, ...data.settings }));
              }
            }
          }
        } else if (branchId) {
          const data = await api.get<SystemConfigResponse>('/tenant-governance/system-config');

          if (data?.settings) {
            setRedemptionThreshold(Number(data.settings.redemptionApprovalThreshold) || 50000);
            setContractTerms(String(data.settings.contractTermsAndConditions || ''));
            setContractResponsibilities(String(data.settings.contractPawnshopResponsibilities || ''));
            setConfig((prev: any) => ({ ...prev, ...data.settings }));
            if (data.globalOverrides) {
              setGlobalConfig(data.globalOverrides);
            }
          }
        }
      } catch (error) {
        console.error('Error in loadSettings:', error);
      } finally {
        setSettingsLoaded(true);
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

  // A field updater, not a save action: it only mutates local form state and
  // the section stays marked unsaved until the footer action commits it.
  const handleBrandingChange = (field: keyof BrandingPayload, value: string) => {
    setBranding((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const takeSnapshot = (): SavedSnapshot => ({
    config: { ...(config as Record<string, boolean>) },
    redemptionThreshold: Number(redemptionThreshold),
    contractTerms,
    contractResponsibilities,
    pawnshopLat,
    pawnshopLng,
    pawnshopAddress,
    branding: {
      displayName: branding.displayName,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
    },
  });

  // The baseline is only trustworthy once both async loads have settled, so it
  // is taken then rather than on first render.
  useEffect(() => {
    if (settingsLoaded && !loadingBranding) {
      setSavedSnapshot(takeSnapshot());
    }
  }, [settingsLoaded, loadingBranding]);

  const dirtySections = useMemo(() => {
    const dirty = new Set<SectionKey>();
    if (!savedSnapshot) return dirty;

    if (JSON.stringify(savedSnapshot.config) !== JSON.stringify(config)) {
      dirty.add('features');
    }
    if (savedSnapshot.redemptionThreshold !== Number(redemptionThreshold)) {
      dirty.add('features');
    }
    if (
      savedSnapshot.contractTerms !== contractTerms ||
      savedSnapshot.contractResponsibilities !== contractResponsibilities
    ) {
      dirty.add('contract');
    }
    if (
      savedSnapshot.pawnshopLat !== pawnshopLat ||
      savedSnapshot.pawnshopLng !== pawnshopLng ||
      savedSnapshot.pawnshopAddress !== pawnshopAddress
    ) {
      dirty.add('location');
    }
    if (BRANDING_COMPARED_FIELDS.some((f) => savedSnapshot.branding[f] !== branding[f])) {
      dirty.add('branding');
    }
    return dirty;
  }, [
    savedSnapshot,
    config,
    redemptionThreshold,
    contractTerms,
    contractResponsibilities,
    pawnshopLat,
    pawnshopLng,
    pawnshopAddress,
    branding,
  ]);

  const isDirty = dirtySections.size > 0;

  const pendingSummary = SECTION_ORDER.filter((s) => dirtySections.has(s)).map(
    (s) => SECTION_LABELS[s],
  );

  // Each saver returns null on success or a reason it could not proceed, and
  // throws on transport failure. The orchestrator folds both into one report so
  // no section can fail silently behind a spinner.
  const saveFeatureSettings = async (): Promise<string | null> => {
    const threshold = Number(redemptionThreshold);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return 'Enter a redemption threshold greater than zero.';
    }

    if (isSuperAdmin) {
      // A super admin write fans out to every branch, so each keeps its own
      // local settings and only gains the global_overrides block. The shop list
      // and each shop's current settings both come from guarded endpoints now.
      const shops = await api.get<Array<{ id: string }>>('/pawnshops');

      for (const shop of shops || []) {
        const current = await api.get<SystemConfigResponse>(
          `/tenant-governance/pawnshops/${shop.id}/settings`,
        );
        const currentSettings = current?.settings || {};
        const updatedSettings = {
          ...currentSettings,
          global_overrides: { ...config },
        };
        await api.patch(`/tenant-governance/pawnshops/${shop.id}/settings`, {
          settings: updatedSettings,
        });
      }
      return null;
    }

    if (!branchId) return 'No branch is selected.';

    const current = await api.get<SystemConfigResponse>('/tenant-governance/system-config');
    const currentSettings = current?.settings || {};

    // Force off anything a super admin has globally disabled, so a branch
    // cannot re-enable a feature it does not own.
    const sanitizedConfig = { ...config };
    if (globalConfig) {
      for (const key of Object.keys(sanitizedConfig)) {
        if (globalConfig[key] === false) {
          (sanitizedConfig as any)[key] = false;
        }
      }
    }

    const updatedSettings = {
      ...currentSettings,
      ...sanitizedConfig,
      redemptionApprovalThreshold: threshold,
    // A branch write preserves the super admin's global_overrides block rather
    // than clobbering it with the branch's local view of the settings.
      global_overrides: currentSettings.global_overrides || {},
    };

    await api.patch(`/tenant-governance/pawnshops/${branchId}/settings`, {
      settings: updatedSettings,
    });
    setConfig((prev: any) => ({ ...prev, ...sanitizedConfig }));
    return null;
  };

  const saveBranding = async (): Promise<void> => {
    if (isSuperAdmin || !branchId) return;
    if (!branding.customBrandingEnabled) {
      throw new Error('Custom branding is available only on the Enterprise plan.');
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

      setBranding(() => ({ ...updatedBranding }));
      onBrandingUpdated?.(updatedBranding);
    } finally {
      setSavingBranding(false);
    }
  };

  const saveContractTerms = async (): Promise<void> => {
    if (!branchId) return;
    setSavingContractTerms(true);
    try {
      await api.patch(`/tenant-governance/pawnshops/${branchId}/contract-terms`, {
        termsAndConditions: contractTerms,
        pawnshopResponsibilities: contractResponsibilities,
      });
    } finally {
      setSavingContractTerms(false);
    }
  };

  const saveLocation = async (): Promise<void> => {
    if (!branchId) return;
    setSavingLocation(true);
    try {
      await api.patch(`/pawnshops/${branchId}/location`, {
        latitude: pawnshopLat,
        longitude: pawnshopLng,
        address: pawnshopAddress,
      });
    } finally {
      setSavingLocation(false);
    }
  };

  const handleSaveAll = async () => {
    if (!isDirty || isSaving) return;

    if (dirtySections.has('location') && (pawnshopLat == null || pawnshopLng == null)) {
      await Swal.fire({
        icon: 'warning',
        title: 'No Location Selected',
        text: 'Click the map or use GPS to set a location, or put the map back the way it was to drop this change.',
        confirmButtonColor: '#ef4444',
      });
      return;
    }

    // The super admin save rewrites settings for every branch in the system, so
    // that keeps a confirmation step. A branch owner writing to their own branch
    // is ordinary settings editing and gains nothing from a second prompt.
    if (isSuperAdmin) {
      const answer = await Swal.fire({
        icon: 'warning',
        title: 'Apply to every branch?',
        text: 'These feature toggles will be written as global overrides across all branches. Your pending contract, location and branding edits are saved only on this branch.',
        showCancelButton: true,
        confirmButtonText: 'Apply to all branches',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#4f46e5',
      });
      if (!answer.isConfirmed) return;
    }

    setIsSaving(true);
    const failedMessages: string[] = [];
    const failedSections = new Set<SectionKey>();

    for (const section of SECTION_ORDER) {
      if (!dirtySections.has(section)) continue;
      try {
        if (section === 'features') {
          const problem = await saveFeatureSettings();
          if (problem) {
            failedMessages.push(problem);
            failedSections.add(section);
          }
        } else if (section === 'contract') {
          await saveContractTerms();
        } else if (section === 'location') {
          await saveLocation();
        } else {
          await saveBranding();
        }
      } catch (error: any) {
        failedMessages.push(error?.message || `Could not save ${SECTION_LABELS[section]}.`);
        failedSections.add(section);
      }
    }

    setIsSaving(false);

    // Only sections that actually reached the server join the new baseline.
    // Folding in a failed section would mark unsaved work as done, which is the
    // one outcome this page must never produce.
    const landed = SECTION_ORDER.filter((s) => dirtySections.has(s) && !failedSections.has(s));
    if (landed.length > 0) {
      setSavedSnapshot((prev) => {
        if (!prev) return prev;
        const fresh = takeSnapshot();
        const next: SavedSnapshot = { ...prev };
        if (landed.includes('features')) {
          next.config = fresh.config;
          next.redemptionThreshold = fresh.redemptionThreshold;
        }
        if (landed.includes('contract')) {
          next.contractTerms = fresh.contractTerms;
          next.contractResponsibilities = fresh.contractResponsibilities;
        }
        if (landed.includes('location')) {
          next.pawnshopLat = fresh.pawnshopLat;
          next.pawnshopLng = fresh.pawnshopLng;
          next.pawnshopAddress = fresh.pawnshopAddress;
        }
        if (landed.includes('branding')) {
          next.branding = fresh.branding;
        }
        return next;
      });
    }

    if (failedMessages.length === 0) {
      setShowToast(true);
      return;
    }

    await Swal.fire({
      icon: 'warning',
      title: 'Partly Saved',
      text: `${failedMessages.join(' ')} Everything else was saved; the failed part is still marked unsaved so you can try again.`,
      confirmButtonColor: '#ef4444',
    });
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
              <p className="text-[10px] text-[#8A8279] mt-1 font-medium">System configuration synchronized.</p>
            </div>
            <button onClick={() => setShowToast(false)} className="ml-4 text-[#8A8279] hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-black text-[#F5F0E8] tracking-tight uppercase italic leading-none">
            {isSuperAdmin ? 'Platform Control' : 'Branch Settings'}
          </h2>
          <p className="text-[#8A8279] font-medium mt-2">
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
        <div className="bg-[#C9A05C] rounded-[2rem] p-6 text-[#0A0A0F] flex items-center gap-6 shadow-xl shadow-indigo-200">
          <div className="bg-[#0A0A0F]/10 p-4 rounded-2xl">
            <ShieldCheck className="w-8 h-8 text-[#0A0A0F]" />
          </div>
          <div>
            <h4 className="font-black uppercase tracking-widest text-sm">Global Master Switches</h4>
            <p className="text-[#1C1C26] text-xs mt-1">
              Changes made here are <span className="underline decoration-[#1C1C26]">authoritative</span>.
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
                  isEnabled
                    ? (isSuperAdmin
                      ? 'bg-[#C9A05C] shadow-indigo-600/20 text-[#0A0A0F]'
                      : 'bg-blue-600 shadow-blue-600/20 text-white')
                    : 'bg-[#1C1C26] text-[#8A8279]'
                } shadow-lg`}>
                  <feature.icon className="w-7 h-7" />
                </div>
                
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={
                    globalDisabled
                      ? `${feature.name} (restricted by platform)`
                      : feature.name
                  }
                  title={
                    globalDisabled
                      ? 'A platform administrator has switched this feature off for every branch.'
                    : undefined
                  }
                  onClick={() => toggleFeature(feature.id)}
                  disabled={globalDisabled}
                  className={`w-14 h-8 rounded-full transition-all duration-300 relative p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A05C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#14141B] ${
                    globalDisabled ? 'bg-slate-300 cursor-not-allowed' : (isEnabled ? (isSuperAdmin ? 'bg-[#C9A05C]' : 'bg-blue-600') : 'bg-[#222228]')
                  }`}
                >
                  <div aria-hidden="true" className={`w-6 h-6 bg-[#14141B] rounded-full shadow-lg transition-transform duration-300 ${isEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${isEnabled ? (isSuperAdmin ? 'text-[#C9A05C]' : 'text-[#C9A05C]') : 'text-[#8A8279]'}`}>
                    {feature.category}
                  </span>
                  {globalDisabled && (
                    <span className="bg-rose-50 text-rose-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter flex items-center gap-1">
                      <ShieldAlert size={8} /> Restricted
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-black text-[#F5F0E8] mb-2">{feature.name}</h3>
                <p className="text-sm text-[#8A8279] font-medium leading-relaxed">{feature.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-[#14141B] rounded-[2.8rem] p-8 border-2 border-[rgba(201,160,92,0.08)] shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A05C]">Redemption Policy</p>
            <h3 className="text-2xl font-black text-[#F5F0E8] mt-1 flex items-center gap-2">
              <Undo2 className="w-6 h-6 text-[#C9A05C]" />
              Redemption Approval Threshold
            </h3>
            <p className="text-sm text-[#8A8279] mt-2">
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
            className="w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-semibold text-[#F5F0E8]"
            placeholder="50000"
          />
        </div>
      </div>

      {!isSuperAdmin && branchId && (
        <div className="bg-[#14141B] rounded-[2.8rem] p-8 border-2 border-[rgba(201,160,92,0.08)] shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A05C]">Contract Policy</p>
              <h3 className="text-2xl font-black text-[#F5F0E8] mt-1 flex items-center gap-2">
                <FileText className="w-6 h-6 text-[#C9A05C]" />
                Contract Terms & Responsibilities
              </h3>
              <p className="text-sm text-[#8A8279] mt-2">
                These appear on every loan contract your pawnshop generates. If you set Terms and Conditions, they replace the standard text. Write one item per line.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label htmlFor="settings-contract-terms" className="text-xs font-black uppercase tracking-wider text-[#8A8279]">Terms and Conditions</label>
              <textarea
 id="settings-contract-terms"                value={contractTerms}
                onChange={(event) => setContractTerms(event.target.value)}
                rows={9}
                placeholder={'1. The Pawnee acknowledges receipt of the loan amount.\n2. Interest accrues monthly at the rate stated on the contract.\n3. The Pawnshop reserves the right to sell the collateral if the loan is not redeemed within the term and grace period.'}
                className="mt-2 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-medium text-[#F5F0E8] bg-[#1C1C26] focus:outline-none focus:border-[#C9A05C]"
              />
            </div>
            <div>
              <label htmlFor="settings-contract-responsibilities" className="text-xs font-black uppercase tracking-wider text-[#8A8279]">Pawnshop Responsibilities</label>
              <textarea
 id="settings-contract-responsibilities"                value={contractResponsibilities}
                onChange={(event) => setContractResponsibilities(event.target.value)}
                rows={6}
                placeholder={'The Pawnshop shall safely store the collateral for the full term of the loan.\nThe Pawnshop shall release the collateral upon full payment of principal and interest.\nThe Pawnshop shall issue a receipt for every payment received.'}
                className="mt-2 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-medium text-[#F5F0E8] bg-[#1C1C26] focus:outline-none focus:border-[#C9A05C]"
              />
            </div>
            <div className="flex justify-end">
              <SectionSaveState dirty={dirtySections.has('contract')} saving={savingContractTerms} />
            </div>
          </div>
        </div>
      )}

      {!isSuperAdmin && branchId && (
        <div className="bg-[#14141B] rounded-[2.8rem] p-8 border-2 border-[rgba(201,160,92,0.08)] shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A05C]">Pawnshop Location</p>
              <h3 className="text-2xl font-black text-[#F5F0E8] mt-1 flex items-center gap-2">
                <MapPin className="w-6 h-6 text-[#C9A05C]" />
                Set Pawnshop on Map
              </h3>
              <p className="text-sm text-[#8A8279] mt-2">
                Pin your pawnshop location. This is used for nearby customer discovery and branch identification.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <LocationPicker
              latitude={pawnshopLat}
              longitude={pawnshopLng}
              onLocationSelect={(lat, lng) => { setPawnshopLat(lat); setPawnshopLng(lng); }}
              onAddressResolve={(address) => setPawnshopAddress(address)}
            />
            {pawnshopAddress && (
              <p className="text-xs text-[#8A8279] font-mono bg-[#1C1C26] px-4 py-3 rounded-xl">{pawnshopAddress}</p>
            )}
            <div className="flex justify-end">
              <SectionSaveState dirty={dirtySections.has('location')} saving={savingLocation} />
            </div>
          </div>
        </div>
      )}

      {!isSuperAdmin && (
        <div className="bg-[#14141B] rounded-[2.8rem] p-8 border-2 border-[rgba(201,160,92,0.08)] shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A05C]">Enterprise Feature</p>
              <h3 className="text-2xl font-black text-[#F5F0E8] mt-1 flex items-center gap-2">
                <Palette className="w-6 h-6 text-[#C9A05C]" />
                Custom Branding
              </h3>
              <p className="text-sm text-[#8A8279] mt-2">
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
            <div className="flex items-center gap-3 text-[#8A8279]">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading branding configuration...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label htmlFor="settings-branding-display-name" className="text-xs font-black uppercase tracking-wider text-[#8A8279]">Display Name</label>
                  <input
 id="settings-branding-display-name"                    type="text"
                    value={branding.displayName}
                    onChange={(event) => handleBrandingChange('displayName', event.target.value)}
                    maxLength={60}
                    disabled={!branding.customBrandingEnabled || savingBranding}
                    className="mt-2 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-semibold text-[#F5F0E8] disabled:bg-[#1C1C26] disabled:text-[#8A8279]"
                    placeholder="Your pawnshop display name"
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="settings-branding-logo-url" className="text-xs font-black uppercase tracking-wider text-[#8A8279]">Logo URL</label>
                  <input
 id="settings-branding-logo-url"                    type="url"
                    value={branding.logoUrl || ''}
                    onChange={(event) => handleBrandingChange('logoUrl', event.target.value)}
                    disabled={!branding.customBrandingEnabled || savingBranding}
                    className="mt-2 w-full rounded-2xl border border-[rgba(201,160,92,0.12)] px-4 py-3 text-sm font-semibold text-[#F5F0E8] disabled:bg-[#1C1C26] disabled:text-[#8A8279]"
                    placeholder="https://example.com/logo.png"
                  />
                </div>

                <div>
                  <label htmlFor="settings-branding-primary-color" className="text-xs font-black uppercase tracking-wider text-[#8A8279]">Primary Color</label>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[rgba(201,160,92,0.12)] px-3 py-2">
                    <input
 id="settings-branding-primary-color"                      type="color"
                      value={branding.primaryColor}
                      onChange={(event) => handleBrandingChange('primaryColor', event.target.value)}
                      disabled={!branding.customBrandingEnabled || savingBranding}
                      className="h-10 w-14 cursor-pointer rounded-xl border-0 bg-transparent disabled:cursor-not-allowed"
                    />
                    <span className="text-xs font-black text-[#B8B0A4] uppercase tracking-widest">{branding.primaryColor}</span>
                  </div>
                </div>

                <div>
                  <label htmlFor="settings-branding-secondary-color" className="text-xs font-black uppercase tracking-wider text-[#8A8279]">Secondary Color</label>
                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[rgba(201,160,92,0.12)] px-3 py-2">
                    <input
 id="settings-branding-secondary-color"                      type="color"
                      value={branding.secondaryColor}
                      onChange={(event) => handleBrandingChange('secondaryColor', event.target.value)}
                      disabled={!branding.customBrandingEnabled || savingBranding}
                      className="h-10 w-14 cursor-pointer rounded-xl border-0 bg-transparent disabled:cursor-not-allowed"
                    />
                    <span className="text-xs font-black text-[#B8B0A4] uppercase tracking-widest">{branding.secondaryColor}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-[rgba(201,160,92,0.12)] p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl" style={{ backgroundColor: branding.primaryColor }} />
                  <div>
                    <p className="text-sm font-black text-[#F5F0E8]">{branding.displayName || branding.pawnshopName || 'PawnGold'}</p>
                    <p className="text-xs text-[#8A8279]">Sidebar preview colors</p>
                  </div>
                </div>
                <SectionSaveState dirty={dirtySections.has('branding')} saving={savingBranding} />
              </div>
            </>
          )}
        </div>
      )}

      {/* SINGLE COMMIT POINT */}
      <div
        className={`sticky bottom-4 z-[120] rounded-[2.5rem] p-6 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-5 overflow-hidden relative shadow-2xl transition-colors duration-500 ${
          isDirty
            ? isSuperAdmin
              ? 'bg-indigo-950'
              : 'bg-slate-900'
            : 'bg-[#14141B] border border-[rgba(201,160,92,0.08)]'
        }`}
      >
        <div className="relative z-10">
          <h3 className="text-lg font-black italic uppercase tracking-tighter">
            {isDirty ? 'Unsaved Changes' : 'Everything Saved'}
          </h3>
          <p className="text-[#8A8279] text-sm font-medium italic mt-1">
            {isDirty
              ? `Pending: ${pendingSummary.join(', ')}.`
              : 'Every setting on this page matches what is stored on the server.'}
          </p>
        </div>
        <button
          onClick={() => void handleSaveAll()}
          disabled={!isDirty || isSaving}
          className={`relative z-10 px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 shadow-lg inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed ${
            // Text follows the surface. Gold #C9A05C is 2.43:1 against white,
            // which fails WCAG AA, so a gold surface takes the dark ink
            // #0A0A0F at 7.85:1. Blue with white passes at 4.6:1, so only the
            // hover state flips.
            !isDirty
              ? 'bg-[#1C1C26] text-[#8A8279] shadow-none'
              : isSuperAdmin
                ? 'bg-[#C9A05C] hover:bg-[#A07D40] text-[#0A0A0F] shadow-indigo-600/20'
                : 'bg-blue-600 hover:bg-[#C9A05C] text-white hover:text-[#0A0A0F] shadow-blue-600/20'
          }`}
        >
          {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSaving ? 'Saving...' : isSuperAdmin ? 'Apply to All Branches' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}