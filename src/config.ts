import type { Config, Env } from './types';

function toInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function readConfig(env: Env): Config {
  return {
    BOT_TOKEN: env.BOT_TOKEN || '',
    ADMIN_ID: toInt(env.ADMIN_ID, 0),
    ADMIN_USERNAME: (env.ADMIN_USERNAME || '').replace(/^@/, ''),
    GROUP_ID: env.GROUP_ID || '',
    // 0 (atau negatif) = unlimited generate
    FREE_DAILY_LIMIT: toInt(env.FREE_DAILY_LIMIT, 0),
    CHANNEL_ID: env.CHANNEL_ID || '',
    CHANNEL_URL: env.CHANNEL_URL || '',
    COOLDOWN_MS: toInt(env.COOLDOWN_MS, 60000),
    DONATION_QRIS_URL: env.DONATION_QRIS_URL || '',
    // Batas <=25: tiap akun butuh ~600ms request Netflix, dan free plan
    // membatasi 50 subrequest per eksekusi Worker.
    BATCH_SIZE: clamp(toInt(env.BATCH_SIZE, 25), 1, 25),
    CONVERT_BATCH: clamp(toInt(env.CONVERT_BATCH, 25), 1, 25),
    BROADCAST_BATCH: clamp(toInt(env.BROADCAST_BATCH, 25), 1, 25),
    // Stiker loading pada generate. 0 = mati (tanpa stiker & tanpa jeda).
    LOADING_MS: clamp(toInt(env.LOADING_MS, 10000), 0, 60000),
    LOADING_STICKERS: (env.LOADING_STICKERS ?? 'mfload').trim(),
    WEBHOOK_PATH: env.WEBHOOK_PATH || '/webhook',
    SECRET_TOKEN: env.SECRET_TOKEN || '',
    SETUP_KEY: env.SETUP_KEY || '',
  };
}
