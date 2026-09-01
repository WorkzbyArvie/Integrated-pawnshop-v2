import { useState, useEffect } from 'react';
import { Users, Shield, Clock, TrendingUp, Loader2, UserMinus, MoreVertical, Trash2, KeyRound, UserCog } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../App';
import { getBackendUrl } from '../lib/backendUrl';
import api from '../lib/apiClient';

interface StaffMatrixProps {
  branchId: string | null;
  userRole?: string;
  activeBranchId?: number | null;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  systemRole: string;
  staffType?: string | null;
  status: string;
  performance: string;
  shift: string;
  clearance: string;
  email?: string;
}

const STAFF_DRAFT_KEY = 'staffmatrix_add_staff_draft';

export function StaffMatrix({ branchId, userRole: propUserRole, activeBranchId = null }: StaffMatrixProps) {
  const normalizeRole = (rawRole: string | null | undefined): string => {
    const normalized = String(rawRole || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    if (normalized === 'BRANCH_ADMIN') return 'ADMIN';
    if (normalized === 'SHOP_ADMIN') return 'ADMIN';
    if (normalized === 'SUPER') return 'SUPER_ADMIN';
    return normalized;
  };

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>(normalizeRole(propUserRole));
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [newStaffData, setNewStaffData] = useState({
    name: '',
    email: '',
    password: '',
    authCode: '',
    role: 'CASHIER_TELLER'
  });
  const [changePasswordData, setChangePasswordData] = useState<{ staffId: string; newPassword: string } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [changeRoleData, setChangeRoleData] = useState<{ staffId: string; staffName: string; currentRole: string; currentRoleCode: string } | null>(null);
  const [manageMenuId, setManageMenuId] = useState<string | null>(null);
  const [inAppCodeInfo, setInAppCodeInfo] = useState<string | null>(null);
  const [authCodeCooldown, setAuthCodeCooldown] = useState(0);
  const [authCodeRequested, setAuthCodeRequested] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STAFF_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setNewStaffData((prev) => ({ ...prev, ...parsed }));
          setShowAddStaffModal(true);
        }
      }
    } catch {
      sessionStorage.removeItem(STAFF_DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    if (!showAddStaffModal) {
      sessionStorage.removeItem(STAFF_DRAFT_KEY);
      return;
    }
    sessionStorage.setItem(STAFF_DRAFT_KEY, JSON.stringify(newStaffData));
  }, [showAddStaffModal, newStaffData]);

  const closeAddStaffModal = () => {
    setShowAddStaffModal(false);
    setInAppCodeInfo(null);
    setAuthCodeCooldown(0);
    setAuthCodeRequested(false);
  };

  useEffect(() => {
    if (authCodeCooldown <= 0) return;
    const id = setTimeout(() => setAuthCodeCooldown((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [authCodeCooldown]);

  const { showToast } = useToast();

  // Get current user role
  useEffect(() => {
    if (propUserRole) {
      setUserRole(normalizeRole(propUserRole));
    } else {
      const session = supabase.auth.getSession();
      session.then(({ data }) => {
        const role = data?.session?.user?.user_metadata?.role || 'STAFF';
        setUserRole(normalizeRole(role));
      });
    }
  }, [propUserRole]);

  const canManageStaff = ['ADMIN', 'SUPER_ADMIN', 'OWNER'].includes(userRole);
  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  const isOwner = userRole === 'OWNER';

  const STAFF_SPECIALIZATIONS = ['CASHIER_TELLER', 'APPRAISER', 'INVENTORY_CUSTODIAN', 'AUDITOR'];

  const STAFF_SPECIALIZATION_LABELS: Record<string, string> = {
    CASHIER_TELLER: 'Cashier/Teller',
    APPRAISER: 'Appraiser',
    INVENTORY_CUSTODIAN: 'Inventory Custodian',
    AUDITOR: 'Auditor (Read Only)',
  };

  const ROLE_LABELS: Record<string, string> = {
    OWNER: 'Owner',
    ADMIN: 'Admin',
    MANAGER: 'Manager',
    HR: 'HR',
    APPROVER: 'Approver',
  };

  const toRolePayload = (selectedRole: string): { role: string; staff_type?: string } => {
    const normalized = normalizeRole(selectedRole);
    if (STAFF_SPECIALIZATIONS.includes(normalized)) {
      return { role: 'STAFF', staff_type: normalized };
    }

    return { role: normalized };
  };

  const roleCodeFromProfile = (profile: any): string => {
    const normalizedRole = normalizeRole(profile?.role);
    const normalizedStaffType = normalizeRole(profile?.staff_type || profile?.staffType);

    if (normalizedRole === 'STAFF' && STAFF_SPECIALIZATIONS.includes(normalizedStaffType)) {
      return normalizedStaffType;
    }

    return normalizedRole;
  };

  const roleLabelFromCode = (roleCode: string): string => {
    const normalized = normalizeRole(roleCode);
    if (STAFF_SPECIALIZATION_LABELS[normalized]) return STAFF_SPECIALIZATION_LABELS[normalized];
    return ROLE_LABELS[normalized] || normalized.replace(/_/g, ' ');
  };

  const getSelectableRoleOptions = () => {
    const options = [
      { value: 'MANAGER', label: 'Manager' },
      { value: 'APPROVER', label: 'Approver' },
      { value: 'HR', label: 'HR' },
      { value: 'CASHIER_TELLER', label: 'Cashier/Teller' },
      { value: 'APPRAISER', label: 'Appraiser' },
      { value: 'INVENTORY_CUSTODIAN', label: 'Inventory Custodian' },
      { value: 'AUDITOR', label: 'Auditor (Read Only)' },
    ];

    if (isOwner || isSuperAdmin) {
      options.unshift({ value: 'ADMIN', label: 'Admin' });
    }

    if (isSuperAdmin) {
      options.unshift({ value: 'OWNER', label: 'Owner' });
    }

    return options;
  };

  const fetchStaffData = async () => {
    setIsLoading(true);
    try {
      // Fetch from Supabase profiles (where platform control creates accounts)
      let query = supabase
        .from('profiles')
        .select('*');

      if (branchId) {
        query = query.eq('pawnshop_id', branchId);
      }

      if (activeBranchId != null) {
        query = query.eq('branch_id', String(activeBranchId));
      }

      const { data, error } = await query;

      if (error) throw error;

      const formattedStaff: StaffMember[] = (data || []).map((u: any) => {
        const roleCode = roleCodeFromProfile(u);

        return {
          id: u.id,
          name: u.full_name || u.email?.split('@')[0] || "Unknown User",
          email: u.email,
          role: roleLabelFromCode(roleCode),
          systemRole: normalizeRole(u.role),
          staffType: STAFF_SPECIALIZATIONS.includes(roleCode) ? roleCode : null,
          status: u.is_online ? "Active" : "Offline",
          performance: u.performance_score ? `${u.performance_score}%` : "N/A",
          shift: u.shift_hours || "Not Assigned",
          clearance: normalizeRole(u.role) === 'SUPER_ADMIN' ? "Lvl 4 Clear" : "Lvl 2 Clear"
        };
      });

      setStaff(formattedStaff);
    } catch (err: unknown) {
      console.error("Staff Matrix Sync Error:", err);
      showToast("Unable to sync personnel database", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newStaffData.name || !newStaffData.email || !newStaffData.password) {
      showToast("Please fill all required fields", "error");
      return;
    }

    if (!newStaffData.authCode.trim()) {
      showToast("Authentication code is required", "error");
      return;
    }

    if (newStaffData.password.length < 8) {
      showToast("Password must be at least 8 characters", "error");
      return;
    }

    if (!branchId) {
      showToast("No pawnshop context detected. Cannot create account without a branch.", "error");
      return;
    }

    try {
      const activePawnshopId = branchId;
      const backendUrl = getBackendUrl();
      const rolePayload = toRolePayload(newStaffData.role);
      
      // Use the working Supabase Auth endpoint (same as AddAdminModal)
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const response = await fetch(`${backendUrl}/auth/create-branch-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { 'Authorization': `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({
          email: newStaffData.email.trim().toLowerCase(),
          password: newStaffData.password,
          role: rolePayload.role,
          staff_type: rolePayload.staff_type,
          pawnshop_id: activePawnshopId,
          branch_id: activeBranchId || undefined,
          full_name: newStaffData.name,
          auth_code: newStaffData.authCode.trim(),
          purpose: 'STAFF_ACCOUNT_CREATE',
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorMsg = result.error || result.message || `Server error (HTTP ${response.status})`;
        throw new Error(errorMsg);
      }

      showToast(`Account "${newStaffData.name}" (${roleLabelFromCode(newStaffData.role)}) created successfully`, "success");
      setNewStaffData({ name: '', email: '', password: '', authCode: '', role: 'CASHIER_TELLER' });
      closeAddStaffModal();
      fetchStaffData();
    } catch (err: unknown) {
      console.error("Error creating staff:", err);
      showToast(`Failed to create account: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  const handleRequestAuthCode = async () => {
    if (!newStaffData.email || !newStaffData.email.includes('@')) {
      showToast('Enter a valid email before requesting auth code', 'error');
      return;
    }

    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/auth/request-auth-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newStaffData.email.trim().toLowerCase(),
          purpose: 'STAFF_ACCOUNT_CREATE',
        }),
      });

      const result = await response.json();
      const payload = result?.data ?? result;
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'Failed to request auth code');
      }

      setAuthCodeCooldown(60);
      setAuthCodeRequested(true);

      if (payload?.deliveryMethod === 'IN_APP' || payload?.warning) {
        if (payload?.authCode) {
          setInAppCodeInfo(`Email delivery is unavailable. Use this verification code instead: ${payload.authCode}`);
        } else {
          setInAppCodeInfo(payload?.warning || 'Email delivery is unavailable.');
        }
        showToast('Email delivery unavailable. Use the code shown in the form.', 'error');
      } else {
        setInAppCodeInfo(null);
        showToast('Authentication code sent to your email.', 'success');
      }
    } catch (err: unknown) {
      showToast(`Failed to request auth code: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleChangePassword = async (staffId: string, newPassword: string) => {
    if (!newPassword) {
      showToast("Please enter a new password", "error");
      return;
    }

    if (newPassword.length < 8) {
      showToast("Password must be at least 8 characters", "error");
      return;
    }

    try {
      await api.post(`/staff/${staffId}/password`, { newPassword });

      showToast("Password changed successfully", "success");
      setChangePasswordData(null);
    } catch (err: unknown) {
      console.error("Error changing password:", err);
      showToast((err instanceof Error ? err.message : String(err)) || "Failed to change password", "error");
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    try {
      await api.del(`/staff/${staffId}`);

      showToast("Staff account removed successfully", "success");
      setDeleteConfirmId(null);
      fetchStaffData();
    } catch (err: unknown) {
      console.error("Error deleting staff:", err);
      showToast(`Failed to remove account: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  const handleChangeRole = async (staffId: string, newRole: string) => {
    try {
      await api.patch(`/staff/${staffId}/role`, { newRole });

      showToast(`Role updated to ${newRole} successfully`, "success");
      setChangeRoleData(null);
      fetchStaffData();
    } catch (err: unknown) {
      console.error("Error changing role:", err);
      showToast(`Failed to change role: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  const canManageStaffMember = (person: StaffMember) => {
    const normalizedStaffRole = person.systemRole;
    
    if (isSuperAdmin) return true;
    // Branch admin/admin cannot manage peers, owners, or super admins.
    if (userRole === 'ADMIN' && !['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(normalizedStaffRole)) return true;
    // Owner is above branch admin and can manage admin/manager/staff/hr.
    if (userRole === 'OWNER' && !['OWNER', 'SUPER_ADMIN'].includes(normalizedStaffRole)) return true;
    return false;
  };

  useEffect(() => {
    fetchStaffData();
  }, [branchId, activeBranchId]);

  // Poll staff status every 30 seconds to keep online/offline labels fresh
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStaffData();
    }, 30000);
    return () => clearInterval(interval);
  }, [branchId, activeBranchId]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Add Staff Button removed from here */}

      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-[#F5F0E8] tracking-tighter uppercase italic">
            Staff <span className="text-[#C9A05C]">Matrix</span>
          </h2>
          <p className="text-[#8A8279] font-medium uppercase text-[10px] tracking-widest">
            Human Capital & Access Management
          </p>
        </div>
        <div className="flex items-center gap-4">
          {canManageStaff && (
            <button 
              onClick={() => setShowAddStaffModal(!showAddStaffModal)}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
            >
              <Users className="w-4 h-4" /> Add Staff
            </button>
          )}
          <div className="text-right">
              <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-tighter">Total Personnel</p>
              <p className="text-2xl font-black text-[#F5F0E8]">{staff.length}</p>
          </div>
        </div>
      </div>

      {showAddStaffModal && canManageStaff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={closeAddStaffModal}>
          <div className="bg-[#14141B] rounded-2xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-[#F5F0E8] mb-4">Add Staff Account</h3>
            <form onSubmit={handleAddStaff} className="space-y-4">
              <input 
                type="text" 
                placeholder="Full Name"
                value={newStaffData.name}
                onChange={(e) => setNewStaffData({...newStaffData, name: e.target.value})}
                className="w-full px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-lg text-sm"
              />
              <input 
                type="email" 
                placeholder="Email"
                value={newStaffData.email}
                onChange={(e) => setNewStaffData({...newStaffData, email: e.target.value})}
                className="w-full px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-lg text-sm"
              />
              <input 
                type="password" 
                placeholder="Password"
                value={newStaffData.password}
                onChange={(e) => setNewStaffData({...newStaffData, password: e.target.value})}
                className="w-full px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-lg text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Authentication code"
                  value={newStaffData.authCode}
                  onChange={(e) => setNewStaffData({...newStaffData, authCode: e.target.value})}
                  className="w-full px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-lg text-sm"
                />
                <button
                  type="button"
                  onClick={handleRequestAuthCode}
                  disabled={authCodeCooldown > 0}
                  className="px-3 py-2 bg-[#222228] text-[#F5F0E8] rounded-lg font-bold text-[10px] uppercase tracking-wide hover:bg-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {authCodeCooldown > 0 ? `${authCodeCooldown}s` : 'Get Code'}
                </button>
              </div>
              {authCodeRequested && (
                <div className="text-[10px] font-semibold text-[#8A8279]">
                  {authCodeCooldown > 0 ? (
                    <span>
                      Resend code in{' '}
                      <span className="font-bold text-[#F5F0E8]">{authCodeCooldown}s</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRequestAuthCode}
                      className="font-semibold underline transition-colors"
                      style={{ color: '#C9A05C' }}
                    >
                      Didn't receive code? Resend
                    </button>
                  )}
                </div>
              )}
              {inAppCodeInfo && (
                <div className="p-3 rounded-lg bg-[#D4A84B]/10 border border-[#D4A84B]/30 text-xs font-semibold text-[#F5F0E8] break-all">
                  ⚠️ {inAppCodeInfo}
                </div>
              )}
              <select 
                value={newStaffData.role}
                onChange={(e) => setNewStaffData({...newStaffData, role: e.target.value})}
                className="w-full px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-lg text-sm"
              >
                {getSelectableRoleOptions().map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button 
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-blue-700"
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={closeAddStaffModal}
                  className="flex-1 bg-[#222228] text-[#F5F0E8] py-2 rounded-lg font-bold text-sm hover:bg-slate-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hidden Password Change Modal */}
      {changePasswordData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setChangePasswordData(null)}>
          <div className="bg-[#14141B] rounded-2xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[#F5F0E8] mb-4">Change Password</h3>
            <input 
              type="password" 
              placeholder="New Password"
              id="new-password-input"
              className="w-full px-3 py-2 border border-[rgba(201,160,92,0.12)] rounded-lg text-sm mb-4"
            />
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  const newPassword = (document.getElementById('new-password-input') as HTMLInputElement)?.value;
                  handleChangePassword(changePasswordData.staffId, newPassword);
                }}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-blue-700"
              >
                Update
              </button>
              <button 
                onClick={() => setChangePasswordData(null)}
                className="flex-1 bg-[#222228] text-[#F5F0E8] py-2 rounded-lg font-bold text-sm hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-[#14141B] rounded-2xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[#F5F0E8] mb-4">Confirm Delete</h3>
            <p className="text-[#B8B0A4] text-sm mb-4">Are you sure you want to delete this staff account?</p>
            <div className="flex gap-2">
              <button 
                onClick={() => handleDeleteStaff(deleteConfirmId)}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-red-700"
              >
                Delete
              </button>
              <button 
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 bg-[#222228] text-[#F5F0E8] py-2 rounded-lg font-bold text-sm hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Role Modal */}
      {changeRoleData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setChangeRoleData(null)}>
          <div className="bg-[#14141B] rounded-2xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[#F5F0E8] mb-2">Change Role</h3>
            <p className="text-[#8A8279] text-sm mb-4">Update role for <span className="font-bold text-slate-800">{changeRoleData.staffName}</span></p>
            <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest mb-2">Current: {changeRoleData.currentRole}</p>
            <select
              id="new-role-select"
              defaultValue={changeRoleData.currentRoleCode}
              className="w-full px-4 py-3 border border-[rgba(201,160,92,0.12)] rounded-xl text-sm font-bold mb-4"
            >
              {getSelectableRoleOptions().map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const newRole = (document.getElementById('new-role-select') as HTMLSelectElement)?.value;
                  handleChangeRole(changeRoleData.staffId, newRole);
                }}
                className="flex-1 bg-[#C9A05C] text-white py-2 rounded-lg font-bold text-sm hover:bg-[#E5C88C]"
              >
                Update Role
              </button>
              <button
                onClick={() => setChangeRoleData(null)}
                className="flex-1 bg-[#222228] text-[#F5F0E8] py-2 rounded-lg font-bold text-sm hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-[#14141B] rounded-[3rem] border border-[rgba(201,160,92,0.08)] shadow-sm">
          <Loader2 className="w-10 h-10 text-[#C9A05C] animate-spin mb-4" />
          <p className="text-[10px] font-black text-[#8A8279] uppercase tracking-widest">Syncing Employee Records...</p>
        </div>
      ) : staff.length > 0 ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {staff.map(person => (
            <div key={person.id} className="bg-[#14141B] p-6 rounded-[2rem] shadow-xl border border-[rgba(201,160,92,0.08)] hover:border-blue-500 transition-all group relative overflow-hidden">
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div className="p-3 bg-[#1C1C26] rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Users className="w-6 h-6" />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${
                    person.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-[#1C1C26] text-[#8A8279]'
                  }`}>
                    {person.status}
                  </span>
                  <div className="flex items-center gap-1 text-[#8A8279]">
                    <Shield className="w-3 h-3" />
                    <span className="text-[9px] font-bold uppercase">{person.clearance}</span>
                  </div>
                </div>
              </div>

              <div className="relative z-10">
                <h3 className="text-xl font-black text-[#F5F0E8]">{person.name}</h3>
                <p className="text-[#8A8279] text-sm font-bold uppercase tracking-tighter mb-4">{person.role}</p>
                
                <div className="flex items-center gap-2 mb-6 bg-[#1C1C26] p-2 rounded-xl">
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-[11px] font-bold text-[#B8B0A4]">{person.shift}</span>
                </div>

                <div className="pt-4 border-t border-slate-50 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-bold">{person.performance}</span>
                  </div>
                  {canManageStaffMember(person) && (
                    <div className="relative">
                      <button 
                        onClick={() => setManageMenuId(manageMenuId === person.id ? null : person.id)}
                        className="text-[10px] font-black text-[#C9A05C] uppercase hover:bg-[#C9A05C]/10 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                        Manage
                      </button>
                      {manageMenuId === person.id && (
                        <div className="absolute right-0 bottom-full mb-2 w-52 bg-[#14141B] rounded-2xl shadow-2xl border border-[rgba(201,160,92,0.12)] py-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                          <button
                            onClick={() => {
                              const currentRoleCode = person.staffType || person.systemRole;
                              setChangeRoleData({
                                staffId: person.id,
                                staffName: person.name,
                                currentRole: person.role,
                                currentRoleCode,
                              });
                              setManageMenuId(null);
                            }}
                            className="w-full text-left px-4 py-3 text-sm font-bold text-[#8A8279] hover:bg-[#C9A05C]/8 hover:text-[#C9A05C] flex items-center gap-3 transition-colors"
                          >
                            <UserCog className="w-4 h-4" /> Change Role
                          </button>
                          <button
                            onClick={() => { setChangePasswordData({ staffId: person.id, newPassword: '' }); setManageMenuId(null); }}
                            className="w-full text-left px-4 py-3 text-sm font-bold text-[#8A8279] hover:bg-amber-50 hover:text-amber-600 flex items-center gap-3 transition-colors"
                          >
                            <KeyRound className="w-4 h-4" /> Change Password
                          </button>
                          <div className="border-t border-[rgba(201,160,92,0.08)] my-1" />
                          <button
                            onClick={() => { setDeleteConfirmId(person.id); setManageMenuId(null); }}
                            className="w-full text-left px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" /> Remove Account
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
                 <Users className="w-32 h-32" />
              </div>
            </div>
          ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 bg-[#1C1C26] rounded-[3rem] border-2 border-dashed border-[rgba(201,160,92,0.12)]">
          <UserMinus className="w-12 h-12 text-slate-300 mb-4" />
          <p className="text-[#8A8279] font-bold uppercase text-[10px] tracking-widest">No personnel assigned to this branch.</p>
        </div>
      )}
    </div>
  );
}