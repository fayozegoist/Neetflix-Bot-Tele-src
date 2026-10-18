import type { Bot } from './bot';

export async function handleDonasi(bot: Bot, chatId: number): Promise<void> {
  const caption =
    `💳 <b>DONASI MEDIAFAIRY</b>\n\n` +
    `Dukung bot tetap aktif & berkembang! 🚀\n\n` +
    `🏦 <b>Metode:</b> QRIS (Semua bank & e-wallet)\n\n` +
    `<i>Donasi bersifat sukarela sebagai bentuk dukungan. Terima kasih sudah mendukung MEDIAFAIRY! 💖</i>`;

  if (bot.cfg.DONATION_QRIS_URL) {
    await bot.api('sendPhoto', {
      chat_id: chatId,
      photo: bot.cfg.DONATION_QRIS_URL,
      caption,
      parse_mode: 'HTML',
    });
  } else {
    await bot.send(chatId, caption);
  }
}