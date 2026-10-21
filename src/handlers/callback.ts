import type { Bot } from '../bot';
import type { TgCallbackQuery } from '../types';
import { isChannelMember, joinGateMarkup, markVerified } from '../gate';
import { mainMenu, countryMarkup } from '../menu';
import { sendVaultPage } from '../vault';
import { processGeneration } from '../generate';

export async function handleCallbackQuery(bot: Bot, callbackQuery: TgCallbackQuery): Promise<void> {
  const message = callbackQuery.message;
  if (!message) return;

  const chatId = message.chat.id;
  const messageId = message.message_id;
  const data = callbackQuery.data || '';
  const userId = callbackQuery.from.id;
  const isAdmin = bot.isAdmin(userId);

  if (data === 'verify_join') {
    if (isAdmin || !bot.cfg.CHANNEL_ID) {
      await bot.api('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: '✅ Akses penuh.', show_alert: false });
      return;
    }
    const member = await isChannelMember(bot, userId);
    if (!member) {
      await bot.api('answerCallbackQuery', {
        callback_query_id: callbackQuery.id,
        text: '❌ Belum terdeteksi join. Pastikan sudah join channel lalu coba lagi.',
        show_alert: true,
      });
      await bot.send(
        chatId,
        '🔒 <b>Anda belum terdaftar sebagai member channel.</b>\nPastikan sudah join lalu tekan <b>Verifikasi</b> lagi.',
        { markup: joinGateMarkup(bot.cfg) }
      );
      return;
    }
    const fresh = await markVerified(bot, userId);
    await bot.api('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: fresh ? '✅ Verifikasi berhasil!' : '✅ Sudah terverifikasi',
      show_alert: false,
    });
    const cooldownSec = Math.round(bot.cfg.COOLDOWN_MS / 1000);
    const msg =
      `✅ <b>Verifikasi Berhasil!</b>\n\n` +
      (fresh
        ? '👋 <b>Selamat datang di MEDIAFAIRY Netflix Token!</b>\n'
        : '👋 <b>Selamat datang kembali!</b>\n') +
      `Bot ini dapat memberikan Anda <i>Token Auto-Login Netflix</i> secara instan.\n\n` +
      `✨ <b>Tanpa batas kuota</b> — dengan jeda <b>${cooldownSec} detik</b> antar generate.\n` +
      `✅ <b>Channel sudah kamu ikuti</b> — siap generate.\n\n` +
      `👇 <b>Silakan pilih menu di bawah ini:</b>`;
    await bot.send(chatId, msg, { markup: mainMenu(false) });
    return;
  }

  // --- Gate join channel untuk semua aksi lain ---
  if (!isAdmin && bot.cfg.CHANNEL_ID) {
    const member = await isChannelMember(bot, userId);
    if (!member) {
      await bot.send(chatId, '🔒 <b>Akses Terkunci.</b>\nJoin channel dulu lalu verifikasi.', { markup: joinGateMarkup(bot.cfg) });
      return;
    }
    await markVerified(bot, userId);
  }

  await bot.api('answerCallbackQuery', { callback_query_id: callbackQuery.id });

  if (data.startsWith('vault_')) {
    const page = parseInt(data.split('_')[1], 10);
    if (Number.isNaN(page)) return;
    const vault = (await bot.kv.getVault()) || [];
    await sendVaultPage(bot, chatId, vault, page, messageId);
    return;
  }

  // Halaman menu negara
  if (data.startsWith('rcpage_')) {
    const page = parseInt(data.split('_')[1], 10);
    if (Number.isNaN(page)) return;
    await bot.api('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: '🌍 <b>Pilih Negara:</b>\nPilih negara akun yang ingin kamu generate.',
      parse_mode: 'HTML',
      reply_markup: countryMarkup(page),
    });
    return;
  }

  // Pilih negara -> generate random
  if (data.startsWith('rc_')) {
    const country = data.slice(3) || 'global';
    const username = callbackQuery.from.username ? `@${callbackQuery.from.username}` : 'TanpaUsername';
    await bot.api('deleteMessage', { chat_id: chatId, message_id: messageId });
    await processGeneration(bot, chatId, userId, username, isAdmin, country);
    return;
  }
}
