import type { Bot } from './bot';
import type { Config } from './types';
import type { InlineButton, ReplyMarkup } from './telegram';
import { getStats } from './stats';

export const JOIN_REWARD = 20;
const OK_STATUSES = ['member', 'administrator', 'creator', 'restricted'];

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

export async function grantJoinReward(bot: Bot, userId: number): Promise<number | null> {
  const s = await getStats(bot, userId);
  if (s.joinRewarded) return null;
  s.extra = (s.extra || 0) + JOIN_REWARD;
  s.joinRewarded = true;
  s.joinRewardedAt = Date.now();
  await bot.kv.setStats(userId, s);
  return JOIN_REWARD;
}