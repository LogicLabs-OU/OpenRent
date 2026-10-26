import { openDB, type IDBPDatabase } from 'idb';

/**
 * Scans made while the network is gone (FR-SCAN-5), kept in IndexedDB until they can be sent to
 * POST /scans/replay. Each has its own id, so sending a batch twice does no harm.
 */
export interface QueuedScan {
  client_id: string;
  mode: 'prepare' | 'check_out' | 'check_in' | 'stock_take' | 'receive';
  code: string;
  occurred_at: string;
  order_id?: string | null;
  stock_take_id?: string | null;
}

export const QUEUEABLE: QueuedScan['mode'][] = ['prepare', 'check_out', 'check_in', 'stock_take', 'receive'];

let db: Promise<IDBPDatabase> | null = null;
const open = () => (db ??= openDB('openrent-scans', 1, { upgrade: (d) => d.createObjectStore('queue', { keyPath: 'client_id' }) }));

export async function queueScan(scan: Omit<QueuedScan, 'client_id' | 'occurred_at'>): Promise<QueuedScan> {
  const item = { ...scan, client_id: crypto.randomUUID(), occurred_at: new Date().toISOString() };
  await (await open()).put('queue', item);
  return item;
}

/** The oldest scans first, at most `limit` (the replay takes 100 at a time). */
export async function queuedScans(limit = 100): Promise<QueuedScan[]> {
  const all = (await (await open()).getAll('queue')) as QueuedScan[];
  return all.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).slice(0, limit);
}

export async function queuedCount(): Promise<number> {
  return (await open()).count('queue');
}

export async function dropScans(ids: string[]) {
  const tx = (await open()).transaction('queue', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/** A request that never reached the server (as opposed to one the server refused). */
export const isOffline = (e: unknown) => (typeof navigator !== 'undefined' && !navigator.onLine) || e instanceof TypeError;
