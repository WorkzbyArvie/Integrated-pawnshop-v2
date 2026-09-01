import { useState } from 'react';
import { 
  MapPin, 
  TrendingUp, 
  Percent, 
  UserPlus, 
  Building,
  ArrowRight
} from 'lucide-react';

// Define the Props interface to accept config
interface ShopOwnerDashboardProps {
  setActiveTab: (tab: string) => void;
  config: {
    hr_enabled: boolean;
    // adding other keys for type safety based on your App.tsx state
    vault_enabled: boolean;
    finance_enabled: boolean;
    auction_enabled: boolean;
    decision_enabled: boolean;
    crm_enabled: boolean;
  };
}

export function ShopOwnerDashboard({ setActiveTab, config }: ShopOwnerDashboardProps) {
  // Mock data for UI development
  const [branches] = useState([
    { id: 1, name: 'Main Branch - Marikina', staffCount: 4, activeTickets: 124 },
    { id: 2, name: 'Market Extension', staffCount: 2, activeTickets: 45 },
  ]);

  return (
    <div className="min-h-screen bg-[#FDFDFF] p-8 space-y-8">
      {/* Brand Header */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-[#C9A05C] text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest">
              Business Suite
            </span>
          </div>
          <h1 className="text-4xl font-light text-[#F5F0E8]">
            Enterprise <span className="font-bold">Overview</span>
          </h1>
          <p className="text-[#8A8279] font-medium mt-1">Manage your branches, staff, and interest policies.</p>
        </div>

        <div className="flex gap-4">
          <button className="flex items-center gap-2 bg-[#14141B] border border-[rgba(201,160,92,0.12)] px-6 py-3 rounded-2xl font-bold text-[#8A8279] hover:bg-[#1C1C26] transition-all">
            <Building size={18} className="text-[#C9A05C]" /> Add Branch
          </button>
          
          {/* CONDITIONALLY RENDER HIRE BUTTON */}
          {config.hr_enabled && (
            <button 
              onClick={() => setActiveTab('hr')}
              className="flex items-center gap-2 bg-[#C9A05C] text-white px-6 py-3 rounded-2xl font-bold hover:bg-[#E5C88C] shadow-lg shadow-indigo-200 transition-all animate-in fade-in zoom-in duration-300"
            >
              <UserPlus size={18} /> Hire Staff
            </button>
          )}
        </div>
      </div>

      {/* Global Stats for the Owner */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#14141B] p-6 rounded-[32px] border border-[rgba(201,160,92,0.08)] shadow-sm text-left">
          <p className="text-xs font-bold text-[#8A8279] uppercase tracking-widest mb-4">Total Portfolio</p>
          <div className="flex items-end gap-2">
            <h2 className="text-3xl font-bold text-[#F5F0E8]">₱4.2M</h2>
            <span className="text-emerald-500 text-xs font-bold mb-1.5 flex items-center">
              <TrendingUp size={12} /> +12%
            </span>
          </div>
        </div>

        <div className="bg-[#14141B] p-6 rounded-[32px] border border-[rgba(201,160,92,0.08)] shadow-sm text-left">
          <p className="text-xs font-bold text-[#8A8279] uppercase tracking-widest mb-4">Current Policy</p>
          <div className="flex items-end gap-2">
            <h2 className="text-3xl font-bold text-[#F5F0E8]">3.5%</h2>
            <span className="text-[#8A8279] text-[10px] font-bold mb-1.5 uppercase">Monthly Interest</span>
          </div>
        </div>

        {/* CONDITIONALLY RENDER STAFF STAT CARD */}
        {config.hr_enabled ? (
          <div className="bg-slate-900 p-6 rounded-[32px] shadow-xl text-left animate-in slide-in-from-right-4 duration-500">
            <p className="text-xs font-bold text-[#8A8279] uppercase tracking-widest mb-4">Total Staff</p>
            <h2 className="text-3xl font-bold text-white">12 Employees</h2>
          </div>
        ) : (
          <div className="bg-[#1C1C26] p-6 rounded-[32px] border border-dashed border-slate-300 flex items-center justify-center">
            <p className="text-[#8A8279] text-xs font-bold uppercase tracking-widest">HR Module Disabled</p>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Branch Management Section */}
        <div className="space-y-6">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <MapPin size={20} className="text-[#C9A05C]" /> Active Branches
          </h3>
          <div className="space-y-4">
            {branches.map((branch) => (
              <div key={branch.id} className="group bg-[#14141B] p-6 rounded-3xl border border-[rgba(201,160,92,0.08)] hover:border-[rgba(201,160,92,0.2)] hover:shadow-xl hover:shadow-slate-200/50 transition-all flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#1C1C26] rounded-2xl flex items-center justify-center text-[#8A8279] group-hover:bg-[#C9A05C]/8 group-hover:text-[#C9A05C] transition-colors">
                    <Building size={24} />
                  </div>
                  <div className="text-left">
                    <h4 className="font-bold text-[#F5F0E8]">{branch.name}</h4>
                    <p className="text-xs text-[#8A8279]">
                      {config.hr_enabled ? `${branch.staffCount} Staff Members • ` : ''} 
                      {branch.activeTickets} Active Tickets
                    </p>
                  </div>
                </div>
                <button className="p-3 bg-[#1C1C26] rounded-xl text-[#8A8279] hover:bg-[#C9A05C] hover:text-white transition-all">
                  <ArrowRight size={20} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Policy & Rules Section */}
        <div className="space-y-6">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Percent size={20} className="text-[#C9A05C]" /> Interest Policy
          </h3>
          <div className="bg-[#14141B] p-8 rounded-[32px] border border-[rgba(201,160,92,0.08)] shadow-sm space-y-8">
            <div className="space-y-4">
              <div className="flex justify-between items-center text-left">
                <label className="text-sm font-bold text-[#8A8279]">Set Branch Interest Rate</label>
                <span className="bg-[#C9A05C]/10 text-[#C9A05C] px-3 py-1 rounded-full text-xs font-black">
                  3.5%
                </span>
              </div>
              <input 
                type="range" 
                className="w-full h-2 bg-[#1C1C26] rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-[10px] font-black text-[#8A8279] uppercase tracking-widest">
                <span>0.5% (Min)</span>
                <span className="text-rose-400">4.0% (Global Cap)</span>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-50 text-left">
              <p className="text-xs text-[#8A8279] leading-relaxed italic">
                Note: Your interest rate cannot exceed the 4.0% limit set by the System Super Admin. 
                Changes apply to new tickets starting tomorrow.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}