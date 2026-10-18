import type { Config, Env } from './types';

function toInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function readConfig(env: Env): Config {
  return {
    BOT_TOKEN: env.BOT_TOKEN || '',
    ADMIN_ID: toInt(env.ADMIN_ID, 0),
    ADMIN_USERNAME: (env.ADMIN_USERNAME || '').replace(/^@/, ''),
    GROUP_ID: env.GROUP_ID || '',
    FREE_DAILY_LIMIT: toInt(env.FREE_DAILY_LIMIT, 10),
    CHANNEL_ID: env.CHANNEL_ID || '',
    CHANNEL_URL: env.CHANNEL_URL || '',
    COOLDOWN_MS: toInt(env.COOLDOWN_MS, 60000),
    DONATION_QRIS_URL: env.DONATION_QRIS_URL || '',
    BATCH_SIZE: Math.min(toInt(env.BATCH_SIZE, 40), 45),
    WEBHOOK_PATH: env.WEBHOOK_PATH || '/webhook',
    SECRET_TOKEN: env.SECRET_TOKEN || '',
    SETUP_KEY: env.SETUP_KEY || '',
  };
}