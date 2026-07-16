import { useEffect, useState } from 'react';
import { getBackendUrl } from '../lib/backendUrl';

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalLoans: 0,
    totalCustomers: 0,
    activeTickets: 0,
    interestEarned: 0,
    growth: "0%"
  });

  useEffect(() => {
    // Calling our new NestJS endpoint
    const backendUrl = getBackendUrl();
    fetch(`${backendUrl}/analytics/stats`)
      .then((res) => res.json())
      .then((raw) => setStats(raw?.data ?? raw))
      .catch((err) => console.error("Could not fetch stats:", err));
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          title="Total Loans" 
          value={`₱${stats.totalLoans.toLocaleString()}`} 
          sub="Active loan portfolio" 
          color="bg-blue-600" 
          icon="💰" 
        />
        <StatCard 
          title="Total Interest" 
          value={`₱${stats.interestEarned.toLocaleString()}`} 
          sub="Est. earnings" 
          color="bg-emerald-600" 
          icon="📈" 
        />
        <StatCard 
          title="Growth" 
          value={stats.growth} 
          sub="Monthly target" 
          color="bg-violet-600" 
          icon="🚀" 
        />
      </div>

      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-6">Operational Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Tickets</p>
            <p className="text-3xl font-black text-slate-900">{stats.activeTickets}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Customers</p>
            <p className="text-3xl font-black text-slate-900">{stats.totalCustomers}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Reusable Card Component
const StatCard = ({ title, value, sub, color, icon }) => (
  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
    <div className="flex justify-between items-start mb-4">
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</p>
        <p className="text-2xl font-black text-slate-900 mt-1">{value}</p>
      </div>
      <div className={`${color} p-3 rounded-xl text-white shadow-lg shadow-current/20`}>{icon}</div>
    </div>
    <p className="text-sm text-slate-500 font-medium">{sub}</p>
  </div>
);

export default Dashboard;