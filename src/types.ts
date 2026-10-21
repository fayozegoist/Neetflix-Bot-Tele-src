export interface Env {
  BOT_TOKEN?: string;
  ADMIN_ID?: string;
  ADMIN_USERNAME?: string;
  GROUP_ID?: string;
  FREE_DAILY_LIMIT?: string;
  CHANNEL_ID?: string;
  CHANNEL_URL?: string;
  COOLDOWN_MS?: string;
  DONATION_QRIS_URL?: string;
  BATCH_SIZE?: string;
  CONVERT_BATCH?: string;
  BROADCAST_BATCH?: string;
  LOADING_MS?: string;
  LOADING_STICKERS?: string;
  WEBHOOK_PATH?: string;
  SECRET_TOKEN?: string;
  SETUP_KEY?: string;
  ADMIN_WEB_KEY?: string;
  DEAD_RETENTION_MS?: string;
  Neetflix_KV: KVNamespace;
  VAULT_DB: D1Database;
}

export interface Config {
  BOT_TOKEN: string;
  ADMIN_ID: number;
  ADMIN_USERNAME: string;
  GROUP_ID: string;
  FREE_DAILY_LIMIT: number;
  CHANNEL_ID: string;
  CHANNEL_URL: string;
  COOLDOWN_MS: number;
  DONATION_QRIS_URL: string;
  BATCH_SIZE: number;
  CONVERT_BATCH: number;
  BROADCAST_BATCH: number;
  /** Durasi stiker loading saat generate (ms). 0 = mati. */
  LOADING_MS: number;
  /** Nama set stiker Telegram, mis. "mfload" dari t.me/addstickers/mfload. */
  LOADING_STICKERS: string;
  WEBHOOK_PATH: string;
  SECRET_TOKEN: string;
  SETUP_KEY: string;
  /** Kunci halaman /admin (upload massal + progress). */
  ADMIN_WEB_KEY: string;
  /** Umur baris `dead` sebelum dipangkas dari D1. */
  DEAD_RETENTION_MS: number;
}

export interface VaultEntry {
  id: number;
  rawText: string;
  email: string;
  region: string;
  /** Kode negara ISO2 hasil resolusi region (opsional, untuk vault lama). */
  country?: string;
  plan: string;
  memberSince: string;
  nextBilling: string;
  /** Status di D1 bila entry berasal dari sana. */
  status?: 'pending' | 'active' | 'dead';
  reason?: string;
}

export interface Stats {
  date: string;
  used: number;
  extra: number;
  lastGen?: number;
  /** Sudah verifikasi join channel (menggantikan joinRewarded). */
  verified?: boolean;
  verifiedAt?: number;
  joinRewarded?: boolean;
  joinRewardedAt?: number;
}

export interface GlobalUser {
  id: number;
  username?: string;
  firstSeen?: string;
}

export interface NfMetadata {
  email: string;
  region: string;
  plan: string;
  memberSince: string;
  nextBilling: string;
}

export interface NfTokenData {
  token: string;
  expires: number;
}

export interface TgUser {  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type?: string;
}

export interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface TgMessage {
  message_id: number;
  from: TgUser;
  chat: TgChat;
  text?: string;
  document?: TgDocument;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id?: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

/** Kode negara ISO2 (mis. 'ID'), atau 'global' untuk semua negara. */
export type CountryFilter = string;