import type { Bot } from './bot';
import type { Stats } from './types';

export const getWIBDate = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

export const nowWIB = (): string =>
  new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function newStats(): Stats {
  return { date: getWIBDate(), used: 0, extra: 0 };
}

export async function getStats(bot: Bot, userId: number): Promise<Stats> {
  const s = (await bot.kv.getStats(userId)) || newStats();
  if (s.date !== getWIBDate()) {
    s.date = getWIBDate();
    s.used = 0;
  }
  return s;
}

/** Kuota dibebaskan sepenuhnya bila limit <= 0 (mode unlimited). */
export function isUnlimited(freeDailyLimit: number): boolean {
  return freeDailyLimit <= 0;
}

/** Sisa kuota; Infinity bila mode unlimited. */
export function remainingQuota(stats: Stats, freeDailyLimit: number): number {
  if (isUnlimited(freeDailyLimit)) return Infinity;
  const base = freeDailyLimit - (stats.used || 0);
  return (base > 0 ? base : 0) + (stats.extra || 0);
}

export async function registerUser(bot: Bot, userId: number, username: string): Promise<void> {
  const users = (await bot.kv.getUsers()) || [];
  if (!users.find((u) => u.id === userId)) {
    users.push({ id: userId, username, firstSeen: new Date().toISOString() });
    await bot.kv.setUsers(users);
  }
}
