/**
 * NotificationCenter -- In-app notification bell + dropdown inbox.
 *
 * Features:
 *   - Bell icon with unread count badge
 *   - Dropdown list of recent notifications
 *   - Mark as read
 *   - Link to full notification settings
 *   - Push token registration (web)
 */

import { useState, useRef, useEffect } from 'react';
import {
  Bell,
  Check,
  Gavel,
  AlertCircle,
  CreditCard,
  Info,
  Clock,
  Loader2,
} from 'lucide-react';
import api from '@/lib/apiClient';
import useApi from '@/lib/useApi';
import { formatDateTime } from '@/lib/formatters';
import type { Notification, NotificationType } from '@/lib/types';

interface NotificationCenterProps {
  userId: string | null;
}

export function NotificationCenter({ userId }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    data: notificationsRaw,
    loading,
    refetch,
  } = useApi<{ data: Notification[]; meta: { total: number } } | Notification[]>(
    userId ? `/notifications/user/${userId}` : null,
    {},
    [userId],
  );

  const notifications: Notification[] = (() => {
    if (!notificationsRaw) return [];
    if (Array.isArray(notificationsRaw)) return notificationsRaw;
    if ((notificationsRaw as any)?.data && Array.isArray((notificationsRaw as any).data)) {
      return (notificationsRaw as any).data;
    }
    return [];
  })();

  const unreadCount = notifications.filter((n) => n.status !== 'READ').length;

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(refetch, 30000);
    return () => clearInterval(interval);
  }, [userId, refetch]);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await api.patch(`/notifications/${notificationId}/read`);
      refetch();
    } catch {
      // Silent fail -- non-critical
    }
  };

  const getIcon = (type: NotificationType) => {
    switch (type) {
      case 'AUCTION_OUTBID':
      case 'AUCTION_WON':
      case 'AUCTION_ENDING':
        return <Gavel className="w-4 h-4 text-[#C9A05C]" />;
      case 'COMPLIANCE_REMINDER':
      case 'COMPLIANCE_DEADLINE':
        return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case 'PAYMENT_RECEIVED':
        return <CreditCard className="w-4 h-4 text-emerald-500" />;
      case 'SYSTEM_ALERT':
        return <AlertCircle className="w-4 h-4 text-rose-500" />;
      default:
        return <Info className="w-4 h-4 text-[#6B655C]" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2.5 rounded-xl hover:bg-white/10 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-[#6B655C]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black text-white shadow-lg">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-full top-12 ml-6 w-96 bg-[#14141B] rounded-2xl shadow-2xl border border-[rgba(201,160,92,0.12)] z-[60] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(201,160,92,0.08)]">
            <h3 className="font-bold text-[#EAE2D6] text-sm">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-xs text-[#C9A05C] font-medium">{unreadCount} unread</span>
            )}
          </div>

          {/* Body */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-[#C9A05C]" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-[#6B655C]">
                <Bell className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No notifications</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-5 py-3.5 border-b border-slate-50 hover:bg-[#1C1C26] transition-colors ${
                    n.status !== 'READ' ? 'bg-[#C9A05C]/10/50' : ''
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0">{getIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${n.status !== 'READ' ? 'font-semibold text-[#EAE2D6]' : 'text-[#999186]'}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-[#6B655C] mt-0.5 line-clamp-2">{n.body}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-[#6B655C] flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(n.createdAt)}
                      </span>
                    </div>
                  </div>
                  {n.status !== 'READ' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkAsRead(n.id);
                      }}
                      className="flex-shrink-0 p-1 rounded-lg hover:bg-[#C9A05C]/15 transition-colors"
                      title="Mark as read"
                    >
                      <Check className="w-3.5 h-3.5 text-[#C9A05C]" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-5 py-3 border-t border-[rgba(201,160,92,0.08)] bg-[#1C1C26]/50">
              <button
                onClick={() => {
                  notifications.filter((n) => n.status !== 'READ').forEach((n) => handleMarkAsRead(n.id));
                }}
                className="text-xs text-[#C9A05C] font-medium hover:text-[#C9A05C]"
              >
                Mark all as read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;
