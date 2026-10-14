import { ref } from 'vue';

import type { ControlClient } from '../platform/control-client.ts';
import { errorMessage } from '../platform/control-client.ts';
import {
  addRecentUsername,
  getRecentUsernames,
  getSavedUsername,
  saveUsername,
} from '../preferences.ts';
import type { ConnectionStatus } from '../types.ts';

export interface LiveStatusResult {
  connected: boolean;
  uniqueId: string | null;
  roomId: string | null;
  connectionId: string | null;
  native: boolean;
}

export interface ConnectionCallbacks {
  goFeed: () => void;
  resetFeed: () => void;
  translate: (key: string) => string;
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '');
}

/** Live connection state: connect form, status, and active creator. */
export function useConnection(control: ControlClient, callbacks: ConnectionCallbacks) {
  const uniqueId = ref(getSavedUsername());
  const cookie = ref('');
  const activeCreator = ref(getSavedUsername());
  const activeCreatorRef = ref(getSavedUsername());
  const recents = ref<string[]>(getRecentUsernames());
  const status = ref<ConnectionStatus>('idle');
  const error = ref('');
  let revision = 0;
  let statusRefresh = 0;
  const unsubscribers: Array<() => void> = [];
  const subscribe: ControlClient['onTopic'] = (topic, handler) => {
    const unsubscribe = control.onTopic(topic, handler);
    unsubscribers.push(unsubscribe);
    return unsubscribe;
  };

  const noteCreatorSeen = (clean: string, persist: boolean): void => {
    activeCreator.value = clean;
    activeCreatorRef.value = clean;
    // The connect input mirrors the authoritative creator — saved user on
    // boot, canonical handle on connect, resync value after a gap — so the
    // header pill and the form never disagree.
    uniqueId.value = clean;
    recents.value = addRecentUsername(clean);
    if (persist) saveUsername(clean);
  };

  const mergeRecentNames = (names: string[]): void => {
    if (names.length > 0) {
      recents.value = [...new Set([...names, ...recents.value])].slice(0, 10);
    }
  };

  subscribe<{ attempt: number; delayMs: number }>('live.reconnecting', () => {
    revision += 1;
    status.value = 'retrying';
  });
  subscribe<{ phase: string; message: string }>('live.error', (data) => {
    status.value = 'error';
    error.value = data.message;
  });
  subscribe<{ uniqueId?: string | null }>('live.connected', (data) => {
    revision += 1;
    status.value = 'connected';
    if (data.uniqueId) noteCreatorSeen(normalizeUsername(data.uniqueId), false);
  });
  subscribe('live.disconnected', () => {
    revision += 1;
    status.value = 'disconnected';
  });

  const requestConnect = async (target: string, sessionCookie: string): Promise<void> => {
    const requestRevision = ++revision;
    try {
      const result = await control.call<LiveStatusResult>('live.connect', {
        uniqueId: target,
        sessionCookie,
      });
      if (requestRevision === revision && !result.connected) status.value = 'disconnected';
    } catch (failure) {
      if (requestRevision !== revision) return;
      status.value = 'error';
      error.value = errorMessage(failure);
    }
  };

  const handleConnect = (userToConnect?: string): void => {
    const target = normalizeUsername(userToConnect || uniqueId.value);
    if (!target) {
      error.value = callbacks.translate('handleRequired');
      return;
    }
    error.value = '';
    callbacks.resetFeed();
    status.value = 'connecting';
    activeCreator.value = target;
    activeCreatorRef.value = target;
    // Write the normalized handle back so the input matches the pill
    // exactly (no stray `@` or whitespace the user typed).
    uniqueId.value = target;
    saveUsername(target);
    recents.value = addRecentUsername(target);
    callbacks.goFeed();
    void requestConnect(target, cookie.value.trim());
  };

  const handlePickLive = (): void => {
    const requestRevision = ++revision;
    error.value = '';
    callbacks.resetFeed();
    status.value = 'connecting';
    const previousCreator = activeCreatorRef.value;
    activeCreator.value = callbacks.translate('searchingRooms');
    callbacks.goFeed();
    void control
      .call<LiveStatusResult>('live.pick', { sessionCookie: cookie.value.trim() })
      .then((result) => {
        if (requestRevision !== revision) return;
        if (!result.connected) {
          status.value = 'disconnected';
          activeCreator.value = previousCreator;
        } else if (result.uniqueId) {
          // Surface the picked creator in the input so the connection can
          // be verified; the pill follows via the live.connected topic.
          uniqueId.value = normalizeUsername(result.uniqueId);
        }
      })
      .catch((failure: unknown) => {
        if (requestRevision !== revision) return;
        status.value = 'error';
        error.value = errorMessage(failure);
        activeCreator.value = previousCreator;
      });
  };

  const handleDisconnect = (): void => {
    const requestRevision = ++revision;
    void control.call('live.disconnect', {}).catch((failure: unknown) => {
      if (requestRevision !== revision) return;
      error.value = errorMessage(failure);
    });
    status.value = 'disconnected';
  };

  const handleReconnect = (): void => {
    if (activeCreatorRef.value) handleConnect(activeCreatorRef.value);
  };

  const handleSelectRecent = (username: string): void => {
    uniqueId.value = username;
    handleConnect(username);
  };

  const setUniqueId = (value: string): void => {
    uniqueId.value = value;
  };
  const setCookie = (value: string): void => {
    cookie.value = value;
  };

  // Authoritative live-status re-read for gap resync: the stream may have
  // skipped connect/disconnect/error transitions, so the status pill is
  // rebuilt from the host instead of reconstructed from guesses.
  const refreshStatus = async (): Promise<void> => {
    const requestRevision = revision;
    const refresh = ++statusRefresh;
    try {
      const result = await control.call<LiveStatusResult>('live.status', {});
      if (requestRevision !== revision || refresh !== statusRefresh) return;
      if (result.connected) {
        status.value = 'connected';
        if (result.uniqueId) noteCreatorSeen(normalizeUsername(result.uniqueId), false);
      } else {
        status.value = 'disconnected';
      }
    } catch (failure) {
      console.warn(`live status refresh failed: ${errorMessage(failure)}`);
    }
  };

  return {
    uniqueId,
    cookie,
    activeCreator,
    recents,
    status,
    error,
    noteCreatorSeen,
    mergeRecentNames,
    handleConnect,
    handlePickLive,
    handleDisconnect,
    handleReconnect,
    handleSelectRecent,
    setUniqueId,
    setCookie,
    refreshStatus,
    dispose: () => { revision += 1; while (unsubscribers.length > 0) unsubscribers.pop()?.(); },
  };
}
