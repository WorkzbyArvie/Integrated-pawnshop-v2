/**
 * AttendanceTracker â€“ Staff attendance with clock-in/out and leave management.
 *
 * Features:
 *   - Auto-loaded staff roster with today's status
 *   - Clock In / Clock Out via staff dropdown
 *   - Attendance records table with filters
 *   - Leave request form
 *   - Staff attendance statistics
 *   - Manual absent marking
 *   - Record verification
 */

import { useState, useCallback } from 'react';
import {
  CalendarDays,
  UserCheck,
  UserX,
  Timer,
  AlertTriangle,
  RefreshCw,
  Filter,
  Loader2,
  ClipboardCheck,
  Calendar,
  TrendingUp,
  Users,
  Save,
  Edit2,
  LogIn,
  LogOut as LogOutIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import api from '@/lib/apiClient';
import useApi from '@/lib/useApi';
import { formatDate, formatTime, formatNumber, statusColor, humanizeStatus } from '@/lib/formatters';
import type { AttendanceRecord, AttendanceStatistics, LeaveType } from '@/lib/types';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '../App';

const LEAVE_TYPES: LeaveType[] = ['SICK', 'VACATION', 'EMERGENCY', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'OTHER'];

interface StaffSchedule {
  shiftStart: string;
  shiftEnd: string;
  workingDays: number;
  lateThreshold: number;
}

interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  role: string;
  todayStatus: string;
  clockIn: string | null;
  clockOut: string | null;
  isLate: boolean;
  lateMinutes: number;
  schedule: StaffSchedule | null;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_BITS   = [1, 2, 4, 8, 16, 32, 64];

interface AttendanceTrackerProps {
  branchId: string | null;
  activeBranchId?: number | null;
  userRole?: string;
}

export function AttendanceTracker({ branchId: _branchId, activeBranchId, userRole: _userRole }: AttendanceTrackerProps) {
  const { showToast } = useToast();
  const normalizedBranchId =
    Number.isInteger(activeBranchId as number) && Number(activeBranchId) > 0
      ? Number(activeBranchId)
      : undefined;

  // â”€â”€ State â”€â”€
  const [staffIdFilter, setStaffIdFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showStatsDialog, setShowStatsDialog] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ shiftStart: '08:00', shiftEnd: '17:00', workingDays: 31, lateThreshold: 15 });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);

  // Leave form
  const [leaveForm, setLeaveForm] = useState({
    staffId: '',
    date: '',
    leaveType: 'SICK' as LeaveType,
    leaveReason: '',
  });

  // Stats view
  const [statsStaffId, setStatsStaffId] = useState('');

  // â”€â”€ Data: Staff list â”€â”€
  const staffQuery: Record<string, string | number | boolean | undefined> = {};
  if (Number.isFinite(normalizedBranchId)) {
    staffQuery.branchId = normalizedBranchId;
  }

  const {
    data: staffList,
    loading: staffLoading,
    refetch: refetchStaff,
  } = useApi<StaffMember[]>('/attendance/staff-list', staffQuery, [normalizedBranchId]);

  const staff: StaffMember[] = Array.isArray(staffList) ? staffList : [];
  const staffMap = new Map(staff.map(s => [s.id, s]));

  // â”€â”€ Data: Attendance records â”€â”€
  const recordsQuery: Record<string, string | number | boolean | undefined> = {};
  if (Number.isFinite(normalizedBranchId)) recordsQuery.branchId = normalizedBranchId;
  if (staffIdFilter) recordsQuery.staffId = staffIdFilter;
  if (dateFrom) recordsQuery.dateFrom = dateFrom;
  if (dateTo) recordsQuery.dateTo = dateTo;

  const {
    data: records,
    loading: recordsLoading,
    error: recordsError,
    refetch: refetchRecords,
  } = useApi<AttendanceRecord[]>('/attendance', recordsQuery, [staffIdFilter, dateFrom, dateTo, normalizedBranchId]);

  const {
    data: stats,
    refetch: refetchStats,
  } = useApi<AttendanceStatistics>(
    statsStaffId ? `/attendance/staff/${statsStaffId}/statistics` : null,
    undefined,
    [statsStaffId],
  );

  const attendanceRecords: AttendanceRecord[] = Array.isArray(records) ? records : [];

  const refetchAll = useCallback(() => {
    refetchRecords();
    refetchStaff();
    if (statsStaffId) refetchStats();
  }, [refetchRecords, refetchStaff, refetchStats, statsStaffId]);

  // â”€â”€ Handlers â”€â”€
  const handleSaveSchedule = async (staffId: string) => {
    setSavingSchedule(true);
    try {
      await api.put(`/attendance/schedules/${staffId}`, scheduleForm);
      showToast('Schedule saved', 'success');
      setEditingScheduleId(null);
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to save schedule', 'error');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleBulkSaveSchedule = async () => {
    if (staff.length === 0) return;
    setSavingBulk(true);
    try {
      await api.post('/attendance/schedules/bulk', {
        staffIds: staff.map(s => s.id),
        ...scheduleForm,
      });
      showToast(`Schedule applied to all ${staff.length} staff members`, 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to save bulk schedule', 'error');
    } finally {
      setSavingBulk(false);
    }
  };

  const startEditSchedule = (s: StaffMember) => {
    setEditingScheduleId(s.id);
    setScheduleForm({
      shiftStart: s.schedule?.shiftStart || '08:00',
      shiftEnd: s.schedule?.shiftEnd || '17:00',
      workingDays: s.schedule?.workingDays ?? 31,
      lateThreshold: s.schedule?.lateThreshold ?? 15,
    });
  };

  const toggleDay = (bit: number) => {
    setScheduleForm(prev => ({ ...prev, workingDays: prev.workingDays ^ bit }));
  };

  const handleRequestLeave = async () => {
    if (!leaveForm.staffId || !leaveForm.date || !leaveForm.leaveReason) {
      showToast('All fields are required', 'error');
      return;
    }
    try {
      await api.post('/attendance/leave', leaveForm);
      showToast('Leave request submitted', 'success');
      setShowLeaveDialog(false);
      setLeaveForm({ staffId: '', date: '', leaveType: 'SICK', leaveReason: '' });
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to submit leave', 'error');
    }
  };

  const handleVerify = async (recordId: string) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const verifiedBy =
        session?.user?.id || localStorage.getItem('user_id') || '';

      if (!verifiedBy) {
        showToast('Unable to identify verifier account', 'error');
        return;
      }

      await api.patch(`/attendance/${recordId}/verify`, {
        verifiedBy,
      });
      showToast('Record verified', 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to verify', 'error');
    }
  };

  const [clockingId, setClockingId] = useState<string | null>(null);

  const handleClockInStaff = async (staffId: string) => {
    setClockingId(staffId);
    try {
      await api.post('/attendance/clock-in', {
        staffId,
        branchId: Number.isFinite(normalizedBranchId)
          ? normalizedBranchId
          : undefined,
      });
      showToast('Staff clocked in', 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to clock in', 'error');
    } finally {
      setClockingId(null);
    }
  };

  const handleClockOutStaff = async (staffId: string) => {
    setClockingId(staffId);
    try {
      await api.post('/attendance/clock-out', { staffId });
      showToast('Staff clocked out', 'success');
      refetchAll();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err) || 'Failed to clock out', 'error');
    } finally {
      setClockingId(null);
    }
  };

  // â”€â”€ Summary from staff list â”€â”€
  const presentCount = staff.filter((s) => s.todayStatus === 'PRESENT' || s.todayStatus === 'LATE').length;
  const lateCount = staff.filter((s) => s.todayStatus === 'LATE' || s.isLate).length;
  const absentCount = staff.filter((s) => s.todayStatus === 'ABSENT').length;
  const onLeaveCount = staff.filter((s) => s.todayStatus === 'ON_LEAVE').length;

  const todayStatusBadge = (status: string, isLate: boolean) => {
    if (status === 'PRESENT' && !isLate) return <Badge className="bg-emerald-100 text-emerald-700">Present</Badge>;
    if (status === 'PRESENT' && isLate) return <Badge className="bg-amber-100 text-amber-700">Present (Late)</Badge>;
    if (status === 'LATE') return <Badge className="bg-amber-100 text-amber-700">Late</Badge>;
    if (status === 'ABSENT') return <Badge className="bg-rose-100 text-rose-700">Absent</Badge>;
    if (status === 'ON_LEAVE') return <Badge className="bg-sky-100 text-sky-700">On Leave</Badge>;
    if (status === 'HALF_DAY') return <Badge className="bg-orange-100 text-orange-700">Half Day</Badge>;
    return <Badge variant="outline" className="text-[#6B655C]">Not Clocked In</Badge>;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-[#EAE2D6] tracking-tight">Attendance Tracker</h1>
          <p className="text-[#6B655C] mt-1">Staff clock-in/out, leave management, and attendance reports</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button variant="outline" onClick={() => setShowLeaveDialog(true)}>
            <Calendar className="w-4 h-4 mr-2" /> Request Leave
          </Button>
        </div>
      </div>

      {/* Today's Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#C9A05C]/15 rounded-xl"><Users className="w-5 h-5 text-[#C9A05C]" /></div>
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{staff.length}</p>
                <p className="text-xs text-[#6B655C]">Total Staff</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-xl"><UserCheck className="w-5 h-5 text-emerald-600" /></div>
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{presentCount}</p>
                <p className="text-xs text-[#6B655C]">Present Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-xl"><Timer className="w-5 h-5 text-amber-600" /></div>
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{lateCount}</p>
                <p className="text-xs text-[#6B655C]">Late</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-100 rounded-xl"><UserX className="w-5 h-5 text-rose-600" /></div>
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{absentCount}</p>
                <p className="text-xs text-[#6B655C]">Absent</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-sky-100 rounded-xl"><CalendarDays className="w-5 h-5 text-sky-600" /></div>
              <div>
                <p className="text-2xl font-black text-[#EAE2D6]">{onLeaveCount}</p>
                <p className="text-xs text-[#6B655C]">On Leave</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-violet-300 transition-colors" onClick={() => setShowStatsDialog(true)}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-100 rounded-xl"><TrendingUp className="w-5 h-5 text-violet-600" /></div>
              <div>
                <p className="text-sm font-bold text-violet-600">View Stats</p>
                <p className="text-xs text-[#6B655C]">Per-staff report</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Staff Roster & Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5" /> Staff Schedule & Today's Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {staffLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[#C9A05C]" />
            </div>
          ) : staff.length === 0 ? (
            <p className="text-center text-[#6B655C] py-8">No staff members found for this pawnshop</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Shift Start</TableHead>
                  <TableHead>Shift End</TableHead>
                  <TableHead>Working Days</TableHead>
                  <TableHead>Today's Status</TableHead>
                  <TableHead>Actual In</TableHead>
                  <TableHead>Actual Out</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.fullName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{s.role}</Badge>
                    </TableCell>
                    {editingScheduleId === s.id ? (
                      <>
                        <TableCell>
                          <Input type="time" className="w-28" value={scheduleForm.shiftStart} onChange={(e) => setScheduleForm({ ...scheduleForm, shiftStart: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input type="time" className="w-28" value={scheduleForm.shiftEnd} onChange={(e) => setScheduleForm({ ...scheduleForm, shiftEnd: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {DAY_LABELS.map((day, i) => (
                              <button
                                key={day}
                                className={`w-8 h-8 text-xs rounded-full font-semibold transition-colors ${
                                  scheduleForm.workingDays & DAY_BITS[i]
                                    ? 'bg-[#C9A05C] text-white'
                                    : 'bg-[#1C1C26] text-[#6B655C]'
                                }`}
                                onClick={() => toggleDay(DAY_BITS[i])}
                              >
                                {day.charAt(0)}
                              </button>
                            ))}
                          </div>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="font-mono text-sm">
                          {s.schedule?.shiftStart || <span className="text-[#6B655C]">â€”</span>}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {s.schedule?.shiftEnd || <span className="text-[#6B655C]">â€”</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-0.5">
                            {DAY_LABELS.map((day, i) => (
                              <span
                                key={day}
                                className={`w-6 h-6 flex items-center justify-center text-[10px] rounded-full ${
                                  s.schedule && (s.schedule.workingDays & DAY_BITS[i])
                                    ? 'bg-[#C9A05C]/15 text-[#C9A05C] font-semibold'
                                    : 'bg-[#1C1C26] text-slate-300'
                                }`}
                              >
                                {day.charAt(0)}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                      </>
                    )}
                    <TableCell>{todayStatusBadge(s.todayStatus, s.isLate)}</TableCell>
                    <TableCell className="font-mono text-sm">{s.clockIn ? formatTime(s.clockIn) : 'â€”'}</TableCell>
                    <TableCell className="font-mono text-sm">{s.clockOut ? formatTime(s.clockOut) : 'â€”'}</TableCell>
                    <TableCell>
                      {editingScheduleId === s.id ? (
                        <div className="flex gap-1">
                          <Button size="sm" className="text-xs bg-[#C9A05C] hover:bg-[#E5C88C]" disabled={savingSchedule} onClick={() => handleSaveSchedule(s.id)}>
                            {savingSchedule ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />} Save
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setEditingScheduleId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          {/* Clock In / Clock Out buttons */}
                          {!s.clockIn && s.todayStatus !== 'ON_LEAVE' && (
                            <Button
                              size="sm"
                              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={clockingId === s.id}
                              onClick={() => handleClockInStaff(s.id)}
                            >
                              {clockingId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogIn className="w-3 h-3 mr-1" />} In
                            </Button>
                          )}
                          {s.clockIn && !s.clockOut && (
                            <Button
                              size="sm"
                              className="text-xs bg-rose-600 hover:bg-rose-700 text-white"
                              disabled={clockingId === s.id}
                              onClick={() => handleClockOutStaff(s.id)}
                            >
                              {clockingId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOutIcon className="w-3 h-3 mr-1" />} Out
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => startEditSchedule(s)}>
                            <Edit2 className="w-3 h-3 mr-1" /> Edit
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-[#6B655C]" />
        <Select value={staffIdFilter || 'all'} onValueChange={(v) => setStaffIdFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Filter by staff..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Staff</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.fullName} ({s.role})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" className="w-44" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" className="w-44" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(staffIdFilter || dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setStaffIdFilter(''); setDateFrom(''); setDateTo(''); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Attendance Table */}
      {recordsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[#C9A05C]" />
        </div>
      ) : recordsError ? (
        <div className="flex items-center justify-center py-12">
          <AlertTriangle className="w-5 h-5 text-rose-500 mr-2" />
          <span className="text-rose-600">{recordsError}</span>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Attendance Records</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Work Hours</TableHead>
                  <TableHead>Overtime</TableHead>
                  <TableHead>Late (min)</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendanceRecords.map((record) => {
                  const member = staffMap.get(record.staffId);
                  return (
                  <TableRow key={record.id}>
                    <TableCell>{formatDate(record.date)}</TableCell>
                    <TableCell className="font-medium">{member?.fullName || record.staffId?.slice(0, 8) + '...'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{member?.role || 'â€”'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColor(record.status)}>{humanizeStatus(record.status)}</Badge>
                    </TableCell>
                    <TableCell>{formatTime(record.clockIn)}</TableCell>
                    <TableCell>{formatTime(record.clockOut)}</TableCell>
                    <TableCell>{record.workHours ? `${record.workHours.toFixed(1)}h` : 'â€”'}</TableCell>
                    <TableCell className={record.overtime && record.overtime > 0 ? 'text-emerald-600 font-medium' : ''}>
                      {record.overtime ? `${record.overtime.toFixed(1)}h` : 'â€”'}
                    </TableCell>
                    <TableCell className={record.lateMinutes && record.lateMinutes > 0 ? 'text-rose-600 font-medium' : ''}>
                      {record.lateMinutes ?? 'â€”'}
                    </TableCell>
                    <TableCell>
                      {record.verifiedBy ? (
                        <Badge variant="outline" className="text-emerald-600">
                          <ClipboardCheck className="w-3 h-3 mr-1" /> Verified
                        </Badge>
                      ) : 'â€”'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {!record.verifiedBy && (
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => handleVerify(record.id)}>
                            Verify
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {attendanceRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-[#6B655C] py-8">No attendance records found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Schedule Settings Dialog â€” bulk apply to all staff */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Settings â€” Apply to All Staff</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Shift Start</label>
                <Input type="time" value={scheduleForm.shiftStart} onChange={(e) => setScheduleForm({ ...scheduleForm, shiftStart: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium text-[#6B655C]">Shift End</label>
                <Input type="time" value={scheduleForm.shiftEnd} onChange={(e) => setScheduleForm({ ...scheduleForm, shiftEnd: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C] block mb-2">Working Days</label>
              <div className="flex gap-2">
                {DAY_LABELS.map((day, i) => (
                  <button
                    key={day}
                    className={`w-10 h-10 text-xs rounded-full font-semibold transition-colors ${
                      scheduleForm.workingDays & DAY_BITS[i]
                        ? 'bg-[#C9A05C] text-white'
                        : 'bg-[#1C1C26] text-[#6B655C] hover:bg-[#222228]'
                    }`}
                    onClick={() => toggleDay(DAY_BITS[i])}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Late Threshold (minutes)</label>
              <Input type="number" min={0} max={120} value={scheduleForm.lateThreshold} onChange={(e) => setScheduleForm({ ...scheduleForm, lateThreshold: parseInt(e.target.value) || 0 })} />
            </div>
            <p className="text-xs text-[#6B655C]">
              This will apply the same schedule to all {staff.length} staff members. To set individual schedules, use the Edit button on each row in the roster.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>Cancel</Button>
            <Button onClick={handleBulkSaveSchedule} disabled={savingBulk}>
              {savingBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Apply to All Staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave Request Dialog */}
      <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Leave</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Select Staff *</label>
              <Select value={leaveForm.staffId} onValueChange={(v) => setLeaveForm({ ...leaveForm, staffId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose staff member..." />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.fullName} ({s.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Date *</label>
              <Input
                type="date"
                value={leaveForm.date}
                onChange={(e) => setLeaveForm({ ...leaveForm, date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Leave Type *</label>
              <Select value={leaveForm.leaveType} onValueChange={(v) => setLeaveForm({ ...leaveForm, leaveType: v as LeaveType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{humanizeStatus(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-[#6B655C]">Reason *</label>
              <Input
                placeholder="Reason for leave..."
                value={leaveForm.leaveReason}
                onChange={(e) => setLeaveForm({ ...leaveForm, leaveReason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeaveDialog(false)}>Cancel</Button>
            <Button onClick={handleRequestLeave}>
              <Calendar className="w-4 h-4 mr-2" /> Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Staff Statistics Dialog */}
      <Dialog open={showStatsDialog} onOpenChange={setShowStatsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Staff Attendance Statistics</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Select value={statsStaffId} onValueChange={setStatsStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose staff member..." />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.fullName} ({s.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {stats && (
              <div className="grid grid-cols-2 gap-4 pt-4">
                <div className="p-3 bg-[#1C1C26] rounded-xl">
                  <p className="text-xs text-[#6B655C]">Total Days</p>
                  <p className="text-lg font-black">{stats.totalDays}</p>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl">
                  <p className="text-xs text-[#6B655C]">Attendance Rate</p>
                  <p className="text-lg font-black text-emerald-700">{stats.attendanceRate?.toFixed(1) ?? 0}%</p>
                </div>
                <div className="p-3 bg-sky-50 rounded-xl">
                  <p className="text-xs text-[#6B655C]">Punctuality Rate</p>
                  <p className="text-lg font-black text-sky-700">{stats.punctualityRate?.toFixed(1) ?? 0}%</p>
                </div>
                <div className="p-3 bg-violet-50 rounded-xl">
                  <p className="text-xs text-[#6B655C]">Total Work Hours</p>
                  <p className="text-lg font-black text-violet-700">{formatNumber(stats.totalWorkHours, 1)}h</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl">
                  <p className="text-xs text-[#6B655C]">Total Overtime</p>
                  <p className="text-lg font-black text-amber-700">{formatNumber(stats.totalOvertime, 1)}h</p>
                </div>
                <div className="p-3 bg-rose-50 rounded-xl">
                  <p className="text-xs text-[#6B655C]">Absent Days</p>
                  <p className="text-lg font-black text-rose-700">{stats.absent}</p>
                </div>
              </div>
            )}
            {!stats && statsStaffId && (
              <p className="text-sm text-[#6B655C] text-center py-8">Loading statistics...</p>
            )}
            {!stats && !statsStaffId && (
              <p className="text-sm text-[#6B655C] text-center py-8">Select a staff member to view statistics</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AttendanceTracker;
