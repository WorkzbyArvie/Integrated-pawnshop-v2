import { Link, useLocation } from 'react-router-dom';

const MainLayout = ({ children }) => {
  const location = useLocation();

  const navigation = [
    { name: 'Dashboard', path: '/', icon: '📊' },
    { name: 'CRM (Customers)', path: '/crm', icon: '👥' },
    { name: 'Pawn Tickets', path: '/tickets', icon: '🎫' },
    { name: 'Inventory', path: '/inventory', icon: '📦' },
    { name: 'Reports', path: '/reports', icon: '📈' },
  ];

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      {/* Sidebar - Based on your Figma Navy Theme */}
      <aside className="w-64 bg-[#0f172a] text-slate-300 flex flex-col border-r border-slate-800">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-900/20">
              P
            </div>
            <span className="text-xl font-bold text-white tracking-tight">PawnHub</span>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1.5 mt-4">
          {navigation.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                location.pathname === item.path
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                  : 'hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="font-medium">{item.name}</span>
            </Link>
          ))}
        </nav>

        {/* User Profile Section at Bottom */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="w-10 h-10 rounded-full bg-slate-700 border-2 border-slate-600"></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">Arvie Admin</p>
              <p className="text-xs text-slate-500 truncate">Manager</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navigation Bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8">
          <h2 className="text-lg font-semibold text-slate-800">
            {navigation.find(n => n.path === location.pathname)?.name || 'Dashboard'}
          </h2>
          <div className="flex items-center gap-4">
             <div className="bg-slate-100 p-2 rounded-full cursor-pointer hover:bg-slate-200 transition">🔔</div>
             <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
               + New Transaction
             </button>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="flex-1 overflow-y-auto p-8">
          {children}
        </main>
      </div>
    </div>
  );
};

export default MainLayout;