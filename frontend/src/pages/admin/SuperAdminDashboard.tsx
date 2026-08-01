
import { PlatformControl } from './PlatformControl';
import { PlatformAnalytics } from './PlatformAnalytics';
import { SystemSettings } from './SystemSettings';
import { TrialRequestsPanel } from './TrialRequestsPanel';
import SuperAdminComplianceOverview from './SuperAdminComplianceOverview';
import { Zap, ShieldCheck, Building2, Settings, ClipboardList, Shield } from 'lucide-react'; 

interface SuperAdminDashboardProps {
  setActiveTab: (tab: string) => void;
  activeTab: string; 
  globalConfig: any; 
  setGlobalConfig: (config: any) => void;
  onManageBranches?: (pawnshopId: string, pawnshopName: string) => void;
}

export function SuperAdminDashboard({ 
  setActiveTab, 
  activeTab, 
  globalConfig, 
  setGlobalConfig,
  onManageBranches,
}: SuperAdminDashboardProps) {

  // Role constant aligned with your profiles table schema [cite: 2026-01-22]
  const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

  return (
    <div className="animate-in fade-in duration-500">
      
      {/* 1. DEFAULT DASHBOARD VIEW */}
      {activeTab === 'dashboard' && (
        <div className="p-8 space-y-10">
          
          <div className="flex justify-between items-end">
            <div className="text-left">
              <h1 className="text-3xl font-black text-[#EAE2D6] tracking-tighter uppercase italic">
                Network <span className="text-[#C9A05C]">Commander</span>
              </h1>
              <p className="text-[#6B655C] text-xs font-bold uppercase tracking-widest mt-1">
                Global Platform Oversight & Administration
              </p>
            </div>
          </div>

          {/* QUICK ACTIONS SECTION - Mapped to Role Access Guidelines [cite: 2026-01-22] */}
          <div className="mt-12">
            <h2 className="text-xl font-black text-[#EAE2D6] tracking-tighter uppercase italic mb-8 flex items-center gap-2">
              <Zap className="text-[#C9A05C]" size={20} />
              Administrative <span className="text-[#C9A05C]">Gateways</span>
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              
              {/* ACTION: PLATFORM CONTROL (Super Admin Access) */}
              <button 
                onClick={() => setActiveTab('platform-control')}
                className="bg-[#14141B] p-10 rounded-[48px] border border-[rgba(201,160,92,0.08)] shadow-2xl shadow-[rgba(201,160,92,0.1)]/50 hover:shadow-indigo-200/60 hover:-translate-y-1 transition-all group text-left relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                  <Building2 size={120} />
                </div>
                <div className="relative z-10">
                  <div className="p-4 w-fit bg-[#C9A05C]/10 rounded-2xl text-[#C9A05C] group-hover:bg-[#C9A05C] group-hover:text-white transition-colors mb-6">
                    <Building2 size={32} />
                  </div>
                  <h3 className="text-2xl font-black text-[#EAE2D6] mb-2 uppercase tracking-tighter">Platform Control</h3>
                  <p className="text-sm text-[#6B655C] font-bold mb-8 leading-relaxed uppercase tracking-tight opacity-70">
                    Onboard new shop locations, manage branch administrators, and monitor network health.
                  </p>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A05C] flex items-center gap-2">
                    Access Infrastructure <span className="group-hover:translate-x-2 transition-transform">â†’</span>
                  </div>
                </div>
              </button>

              {/* ACTION: SYSTEM SETTINGS (Super Admin Access) */}
              <button 
                onClick={() => setActiveTab('system-settings')}
                className="bg-[#14141B] p-10 rounded-[48px] border border-[rgba(201,160,92,0.08)] shadow-2xl shadow-slate-200/40 hover:shadow-[rgba(201,160,92,0.1)] hover:-translate-y-1 transition-all group text-left relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                  <Settings size={120} />
                </div>
                <div className="relative z-10">
                  <div className="p-4 w-fit bg-slate-900 rounded-2xl text-white mb-6">
                    <ShieldCheck size={32} />
                  </div>
                  <h3 className="text-2xl font-black text-[#EAE2D6] mb-2 uppercase tracking-tighter">System Control</h3>
                  <p className="text-sm text-[#6B655C] font-bold mb-8 leading-relaxed uppercase tracking-tight opacity-70">
                    Configure interest caps, audit logs, and global security protocols for all tenants.
                  </p>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#EAE2D6] flex items-center gap-2">
                    Open Protocols <span className="group-hover:translate-x-2 transition-transform">â†’</span>
                  </div>
                </div>
              </button>

              {/* ACTION: TRIAL REQUESTS */}
              <button 
                onClick={() => setActiveTab('trial-requests')}
                className="bg-[#14141B] p-10 rounded-[48px] border border-[rgba(201,160,92,0.08)] shadow-2xl shadow-cyan-100/40 hover:shadow-cyan-200/60 hover:-translate-y-1 transition-all group text-left relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                  <ClipboardList size={120} />
                </div>
                <div className="relative z-10">
                  <div className="p-4 w-fit bg-cyan-50 rounded-2xl text-cyan-700 mb-6 group-hover:bg-cyan-600 group-hover:text-white transition-colors">
                    <ClipboardList size={32} />
                  </div>
                  <h3 className="text-2xl font-black text-[#EAE2D6] mb-2 uppercase tracking-tighter">Trial Requests</h3>
                  <p className="text-sm text-[#6B655C] font-bold mb-8 leading-relaxed uppercase tracking-tight opacity-80">
                    Review onboarding submissions, chat with owners, and approve or reject trial access requests.
                  </p>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-700 flex items-center gap-2">
                    Open Queue <span className="group-hover:translate-x-2 transition-transform">â†’</span>
                  </div>
                </div>
              </button>

              {/* ACTION: COMPLIANCE OVERVIEW */}
              <button 
                onClick={() => setActiveTab('platform-compliance')}
                className="bg-[#14141B] p-10 rounded-[48px] border border-[rgba(201,160,92,0.08)] shadow-2xl shadow-amber-100/40 hover:shadow-amber-200/60 hover:-translate-y-1 transition-all group text-left relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                  <Shield size={120} />
                </div>
                <div className="relative z-10">
                  <div className="p-4 w-fit bg-amber-50 rounded-2xl text-amber-700 mb-6 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                    <Shield size={32} />
                  </div>
                  <h3 className="text-2xl font-black text-[#EAE2D6] mb-2 uppercase tracking-tighter">Compliance</h3>
                  <p className="text-sm text-[#6B655C] font-bold mb-8 leading-relaxed uppercase tracking-tight opacity-80">
                    Review pawnshop documents, verify regulatory compliance, and manage document lifecycle.
                  </p>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700 flex items-center gap-2">
                    Open Compliance <span className="group-hover:translate-x-2 transition-transform">â†’</span>
                  </div>
                </div>
              </button>

            </div>
          </div>
        </div>
      )}

      {/* 1B. TAB: PLATFORM ANALYTICS */}
      {activeTab === 'platform-analytics' && <PlatformAnalytics />}

      {activeTab === 'platform-control' && (
        <PlatformControl 
          userRole={SUPER_ADMIN_ROLE}
          onManageBranches={onManageBranches}
        />
      )}

      {/* 3. TAB: SYSTEM SETTINGS */}
      {activeTab === 'system-settings' && (
        <div className="p-0">
          <SystemSettings 
            config={globalConfig} 
            setConfig={setGlobalConfig} 
            userRole={SUPER_ADMIN_ROLE} 
          />
        </div>
      )}

      {/* 4. TAB: TRIAL REQUESTS */}
      {activeTab === 'trial-requests' && <TrialRequestsPanel />}

      {/* 5. TAB: COMPLIANCE OVERVIEW */}
      {activeTab === 'platform-compliance' && <SuperAdminComplianceOverview />}
    </div>
  );
}