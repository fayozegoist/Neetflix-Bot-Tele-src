import type { Bot } from './bot';
import { randomStickerId } from './stickers';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface TgSentMessage {
  message_id?: number;
}

export interface Loading {
  /** `true` bila stiker loading benar-benar terkirim (bukan fallback teks). */
  shown: boolean;
  /**
   * Tunggu sampai durasi loading genap, lalu hapus stiker.
   *
   * Idempoten: panggilan kedua dan seterusnya langsung selesai. Tidak pernah
   * melempar error, jadi tidak bisa menggagalkan proses generate.
   */
  finish(): Promise<void>;
}

/**
 * Tampilkan stiker loading acak sebagai penanda proses generate.
 *
 * `LOADING_MS` = 0 mematikan fitur ini. Bila stiker gagal dikirim, `shown`
 * bernilai `false` sehingga pemanggil bisa memakai teks "Memverifikasi…"
 * sebagai gantinya.
 */
export async function startLoading(bot: Bot, chatId: number): Promise<Loading> {
  const ms = bot.cfg.LOADING_MS;
  const startedAt = Date.now();
  let messageId: number | null = null;

  if (ms > 0) {
    try {
      const sticker = await randomStickerId(bot);
      if (sticker) {
        const res = await bot.api<TgSentMessage>('sendSticker', { chat_id: chatId, sticker });
        if (res.ok && res.result?.message_id) messageId = res.result.message_id;
      }
    } catch {
      messageId = null;
    }
  }

  let done = false;
  return {
    shown: messageId !== null,
    async finish(): Promise<void> {
      if (done || messageId === null) return;
      done = true;
      try {
        const rest = ms - (Date.now() - startedAt);
        if (rest > 0) await sleep(rest);
        await bot.api('deleteMessage', { chat_id: chatId, message_id: messageId });
      } catch {
        // Stiker gagal dihapus bukan masalah besar — jangan ganggu hasil.
      }
    },
  };
}
