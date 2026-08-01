'use client';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  Package,
  LogOut,
  ShieldCheck,
  Banknote,
  Settings,
  RotateCcw,
  Wallet,
  UserSquare2,
  Gavel,
  BrainCircuit,
  GitBranch,
} from 'lucide-react';

type Role = string;

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
  isMobileView: boolean;
  userRole: Role;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  roles: string[];
}

const allNavItems: NavItem[] = [
  { id: 'dashboard',     label: 'Dashboard',        icon: LayoutDashboard, roles: ['ADMIN', 'STAFF', 'OWNER', 'MANAGER'] },
  { id: 'branches',      label: 'Tenant Branches', icon: GitBranch,       roles: ['SUPER_ADMIN'] },
  { id: 'system',        label: 'System Control',   icon: Settings,        roles: ['SUPER_ADMIN'] },
  { id: 'loans',         label: 'Loan Management',  icon: Banknote,        roles: ['ADMIN', 'STAFF', 'OWNER', 'MANAGER'] },
  { id: 'customers',     label: 'Customers',        icon: Users,           roles: ['ADMIN', 'STAFF', 'OWNER', 'MANAGER'] },
  { id: 'inventory',     label: 'Inventory & Vault', icon: Package,        roles: ['ADMIN', 'MANAGER', 'OWNER'] },
  { id: 'redemption',    label: 'Redemption',       icon: RotateCcw,       roles: ['ADMIN', 'STAFF', 'OWNER', 'MANAGER'] },
  { id: 'ai-support',    label: 'Decision Support', icon: BrainCircuit,    roles: ['OWNER'] },
  { id: 'finance',       label: 'Finance & Treasury', icon: Wallet,        roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { id: 'staff',         label: 'Staff Matrix',     icon: UserSquare2,     roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { id: 'auction',       label: 'Auction House',    icon: Gavel,           roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { id: 'auction-queue', label: 'Auction Queue',    icon: Gavel,           roles: ['ADMIN', 'OWNER', 'MANAGER'] },
];

function normalizeRole(rawRole: string): string {
  const normalized = String(rawRole || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized === 'BRANCH_ADMIN') return 'ADMIN';
  if (normalized === 'SHOP_ADMIN')   return 'ADMIN';
  if (normalized === 'SUPER')        return 'SUPER_ADMIN';
  return normalized;
}

export function Sidebar({ activeView, onNavigate, isMobileView, userRole }: SidebarProps) {
  const [mounted, setMounted] = useState(false);
  const normalizedUserRole = normalizeRole(userRole);
  const visibleNavItems = allNavItems.filter(item => item.roles.includes(normalizedUserRole));

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  const collapsed = isMobileView;

  return (
    <div
      className={`
        flex flex-col h-screen py-4
        transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
        ${collapsed ? 'px-2 w-[72px]' : 'px-3 w-64'}
      `}
      style={{ background: 'transparent' }}
    >
      {/* ── Floating Island shell ── */}
      <div
        className="flex flex-col flex-1 overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(160deg, rgba(28,28,38,0.95) 0%, rgba(10,10,15,0.98) 100%)',
          border: '1px solid rgba(201,160,92,0.18)',
          boxShadow: '0 0 0 1px rgba(201,160,92,0.06) inset, 0 24px 64px rgba(0,0,0,0.55), 0 4px 16px rgba(201,160,92,0.06)',
          backdropFilter: 'blur(24px)',
        }}
      >
        {/* ── Logo mark ── */}
        <div
          className={`flex items-center gap-3 ${collapsed ? 'justify-center p-4' : 'p-5'} border-b`}
          style={{ borderColor: 'rgba(201,160,92,0.1)' }}
        >
          {/* Double-Bezel icon */}
          <div
            className="relative flex-shrink-0 w-9 h-9 rounded-[14px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
              boxShadow: '0 0 0 1px rgba(201,160,92,0.35), 0 4px 12px rgba(201,160,92,0.25)',
            }}
          >
            <ShieldCheck className="w-[18px] h-[18px] text-[#0A0A0F]" strokeWidth={2.5} />
          </div>

          {!collapsed && (
            <div
              className="overflow-hidden"
              style={{
                animation: mounted ? 'fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) both' : 'none',
              }}
            >
              <h2
                className="font-black tracking-tighter text-[15px] uppercase leading-none"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
              >
                PawnGold
              </h2>
              <p
                className="text-[9px] uppercase tracking-[0.22em] font-semibold mt-[3px]"
                style={{ color: 'var(--gold)' }}
              >
                {userRole.replace(/_/g, ' ')}
              </p>
            </div>
          )}
        </div>

        {/* ── Nav list ── */}
        <nav className="flex-1 overflow-y-auto py-3 px-2" style={{ scrollbarWidth: 'none' }}>
          <ul className="flex flex-col gap-[3px]">
            {visibleNavItems.map((item, i) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;

              return (
                <li
                  key={item.id}
                  style={{
                    clipPath: mounted ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)',
                    transition: `clip-path 0.38s cubic-bezier(0.16,1,0.3,1) ${i * 42}ms, opacity 0.38s ease ${i * 42}ms`,
                    opacity: mounted ? 1 : 0,
                  }}
                >
                  <button
                    onClick={() => onNavigate(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={`
                      w-full flex items-center gap-3 transition-all duration-200
                      ${collapsed ? 'justify-center px-0 py-3 rounded-2xl' : 'px-3 py-[10px] rounded-2xl'}
                    `}
                    style={
                      isActive
                        ? {
                            background: 'linear-gradient(135deg, rgba(201,160,92,0.18) 0%, rgba(201,160,92,0.08) 100%)',
                            border: '1px solid rgba(201,160,92,0.28)',
                            boxShadow: '0 0 0 1px rgba(201,160,92,0.08) inset, 0 2px 12px rgba(201,160,92,0.12)',
                          }
                        : {
                            background: 'transparent',
                            border: '1px solid transparent',
                          }
                    }
                  >
                    {/* Icon wrapper — inner button layer */}
                    <div
                      className="relative flex-shrink-0 flex items-center justify-center rounded-[10px] transition-all duration-200"
                      style={
                        isActive
                          ? {
                              width: 30,
                              height: 30,
                              background: 'linear-gradient(135deg, #C9A05C 0%, #A07D40 100%)',
                              boxShadow: '0 0 0 1px rgba(201,160,92,0.4), 0 4px 10px rgba(201,160,92,0.28)',
                            }
                          : {
                              width: 30,
                              height: 30,
                              background: 'rgba(255,255,255,0.04)',
                              boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
                            }
                      }
                    >
                      <Icon
                        className="w-[15px] h-[15px] transition-colors duration-200"
                        strokeWidth={isActive ? 2.5 : 1.8}
                        style={{ color: isActive ? '#0A0A0F' : 'var(--text-secondary)' }}
                      />
                    </div>

                    {!collapsed && (
                      <span
                        className="text-[13px] font-semibold tracking-[-0.01em] transition-colors duration-200"
                        style={{
                          fontFamily: 'var(--font-body)',
                          color: isActive ? 'var(--gold-light)' : 'var(--text-secondary)',
                        }}
                      >
                        {item.label}
                      </span>
                    )}

                    {/* Active indicator dot */}
                    {isActive && !collapsed && (
                      <div
                        className="ml-auto w-[5px] h-[5px] rounded-full flex-shrink-0"
                        style={{ background: 'var(--gold)', boxShadow: '0 0 6px rgba(201,160,92,0.6)' }}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ── Footer ── */}
        <div
          className="px-2 pb-3 pt-2 border-t"
          style={{ borderColor: 'rgba(201,160,92,0.1)' }}
        >
          <button
            className={`
              w-full flex items-center gap-3 transition-all duration-200 rounded-2xl group
              ${collapsed ? 'justify-center px-0 py-3' : 'px-3 py-[10px]'}
            `}
            style={{ border: '1px solid transparent' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(212,69,69,0.08)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(212,69,69,0.2)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
            }}
          >
            <div
              className="flex-shrink-0 flex items-center justify-center rounded-[10px] w-[30px] h-[30px] transition-all duration-200 group-hover:bg-red-500/15"
              style={{ background: 'rgba(255,255,255,0.04)', boxShadow: '0 0 0 1px rgba(255,255,255,0.06)' }}
            >
              <LogOut className="w-[15px] h-[15px]" strokeWidth={1.8} style={{ color: 'var(--red)' }} />
            </div>
            {!collapsed && (
              <span
                className="text-[13px] font-semibold tracking-[-0.01em]"
                style={{ fontFamily: 'var(--font-body)', color: 'var(--red)' }}
              >
                Sign Out
              </span>
            )}
          </button>

          {!collapsed && (
            <div
              className="mt-3 px-3 flex items-center gap-2"
              style={{
                opacity: mounted ? 1 : 0,
                transition: 'opacity 0.5s ease 0.6s',
              }}
            >
              <div
                className="w-[6px] h-[6px] rounded-full"
                style={{
                  background: 'var(--green)',
                  boxShadow: '0 0 6px rgba(61,168,108,0.7)',
                  animation: 'goldPulse 2.4s ease-in-out infinite',
                }}
              />
              <span
                className="text-[9px] uppercase tracking-[0.2em] font-semibold"
                style={{ color: 'var(--text-muted)' }}
              >
                System Online
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
