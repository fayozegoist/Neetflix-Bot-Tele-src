import type { GlobalUser, Stats } from './types';

const JSON_OPTIONS = { type: 'json' as const };

export class KVStore {
  constructor(private readonly ns: KVNamespace) {}

  async getString(key: string): Promise<string | null> {
    return this.ns.get(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    return this.ns.get(key, JSON_OPTIONS) as Promise<T | null>;
  }

  put(key: string, value: unknown): Promise<void> {
    return this.ns.put(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  del(key: string): Promise<void> {
    return this.ns.delete(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.ns.list({ prefix, cursor });
      page.keys.forEach((k) => out.push(k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
  }

  getUsers(): Promise<GlobalUser[] | null> {
    return this.getJson<GlobalUser[]>('global_users');
  }

  setUsers(users: GlobalUser[]): Promise<void> {
    return this.put('global_users', users);
  }

  getStats(userId: number): Promise<Stats | null> {
    return this.getJson<Stats>('stats_' + userId);
  }

  setStats(userId: number, stats: Stats): Promise<void> {
    return this.put('stats_' + userId, stats);
  }

  getCursor(key: string): Promise<number> {
    return this.getString(key).then((v) => {
      const n = parseInt(v || '0', 10);
      return Number.isFinite(n) ? n : 0;
    });
  }

  setCursor(key: string, value: number): Promise<void> {
    return this.put(key, String(value));
  }

  getPendingMessage(key: string): Promise<string | null> {
    return this.getString(key);
  }
}