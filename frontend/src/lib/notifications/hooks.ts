import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Notification } from '../../../../shared/api-contracts.js';
import { useSettings } from '../useSettings';
import type { NotificationPrefs, NotificationPrefsPatch } from '../settings';

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['notifications'] });
}

export function useNotificationInbox(params: { unread?: boolean; kind?: string } = {}) {
  return useQuery({
    queryKey: ['notifications', 'inbox', params] as const,
    queryFn: () => api<{ items: Notification[]; nextCursor: number | null }>('/api/notifications', {
      query: { unread: params.unread ? '1' : undefined, kind: params.kind },
    }),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'] as const,
    queryFn: () => api<{ count: number }>('/api/notifications/unread-count'),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/notifications/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useTestNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Notification>('/api/notifications/test', { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
    onError: () => {
      // 422 { error: 'notifications_disabled' } when the user has disabled
      // notifications — surfaced as a toast in Task 10.
    },
  });
}

// Reads/patches settings.notifications on top of useSettings() so the
// Settings → Notifications page and App.tsx's fan-out share the same
// ['settings'] cache instead of issuing a second GET.
export function useNotificationPrefs(): {
  prefs: NotificationPrefs;
  isReady: boolean;
  patch: (p: NotificationPrefsPatch) => void;
  mutation: ReturnType<typeof useSettings>['mutation'];
} {
  const { settings, isReady, patch, mutation } = useSettings();
  return {
    prefs: settings.notifications,
    isReady,
    patch: (p) => patch({ notifications: p }),
    mutation,
  };
}
