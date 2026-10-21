import type { Bot } from './bot';
import type { Config } from './types';
import type { InlineButton, ReplyMarkup } from './telegram';
import { getStats } from './stats';

const OK_STATUSES = ['member', 'administrator', 'creator', 'restricted'];

/** Bonus kuota untuk join channel. Tidak lagi dipakai (mode unlimited). */
export const JOIN_REWARD = 0;

export async function isChannelMember(bot: Bot, userId: number): Promise<boolean> {
  if (!bot.cfg.CHANNEL_ID) return true;
  try {
    const res = await bot.api<{ status?: string }>('getChatMember', {
      chat_id: bot.cfg.CHANNEL_ID,
      user_id: userId,
    });
    if (!res || !res.ok) return false;
    const status = res.result?.status;
    return status ? OK_STATUSES.includes(status) : false;
  } catch {
    return false;
  }
}

export function joinGateMarkup(cfg: Config): ReplyMarkup {
  const buttons: InlineButton[][] = [];
  if (cfg.CHANNEL_URL) buttons.push([{ text: '📢 Join Channel', url: cfg.CHANNEL_URL }]);
  buttons.push([{ text: '✅ Saya Sudah Join / Verifikasi', callback_data: 'verify_join' }]);
  return { inline_keyboard: buttons };
}

/**
 * Tandai user sudah verifikasi join channel.
 * Return true bila baru pertama kali terverifikasi.
 */
export async function markVerified(bot: Bot, userId: number): Promise<boolean> {
  const s = await getStats(bot, userId);
  if (s.verified) return false;
  s.verified = true;
  s.verifiedAt = Date.now();
  await bot.kv.setStats(userId, s);
  return true;
}
