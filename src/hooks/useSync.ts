import { useSyncExternalStore } from 'react';
import { syncStore, type SyncStatus } from '../cloud/sync';

/** Live cloud-sync status (connection, queue, conflicts, last refresh). */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncStore.subscribe, syncStore.get, syncStore.get);
}
