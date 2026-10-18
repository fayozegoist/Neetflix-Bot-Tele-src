import type { Config } from './types';

export interface TgResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface InlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface ReplyMarkup {
  keyboard?: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  inline_keyboard?: InlineButton[][];
}

export interface SendOptions {
  markup?: ReplyMarkup;
}

export async function tg(
  cfg: Config,
  method: string,
  payload: Record<string, unknown>
): Promise<TgResult> {
  if (!cfg.BOT_TOKEN) return { ok: false };
  const res = await fetch(`https://api.telegram.org/bot${cfg.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<TgResult>;
}

export async function sendMessage(
  cfg: Config,
  chatId: number,
  msgText: string,
  options: SendOptions = {}
): Promise<TgResult> {
  let textToSend = msgText;
  if (textToSend.length > 4000) {
    textToSend = textToSend.substring(0, 4000) + '\n\n...[Pesan Terpotong karena limit Telegram]';
  }
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: textToSend,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (options.markup) payload.reply_markup = options.markup;
  return tg(cfg, 'sendMessage', payload);
}

export const adminContact = (cfg: Config): string =>
  cfg.ADMIN_USERNAME
    ? `<a href="tg://user?id=${cfg.ADMIN_ID}">@${cfg.ADMIN_USERNAME}</a>`
    : `<a href="tg://user?id=${cfg.ADMIN_ID}">Admin</a>`;

export function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}