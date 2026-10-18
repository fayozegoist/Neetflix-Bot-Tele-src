import type { Bot } from '../bot';
import type { RegionFilter, TgCallbackQuery } from '../types';
import { grantJoinReward, isChannelMember, joinGateMarkup } from '../gate';
import { mainMenu } from '../menu';
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
    const granted = await grantJoinReward(bot, userId);
    await bot.api('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: granted ? `🎁 +${granted} kuota!` : '✅ Verifikasi berhasil',
      show_alert: false,
    });
    const msg = granted
      ? `✅ <b>Verifikasi Berhasil!</b>\n\n🎁 Reward <b>+${granted} kuota ekstra</b> telah ditambahkan ke akun Anda (hanya sekali).\nSilakan pilih menu di bawah ini:`
      : '✅ <b>Verifikasi Berhasil!</b>\nSelamat datang kembali!';
    await bot.send(chatId, msg, { markup: mainMenu(false) });
    return;
  }

  if (!isAdmin && bot.cfg.CHANNEL_ID) {
    const member = await isChannelMember(bot, userId);
    if (!member) {
      await bot.send(chatId, '🔒 <b>Akses Terkunci.</b>\nJoin channel dulu lalu verifikasi.', { markup: joinGateMarkup(bot.cfg) });
      return;
    }
    await grantJoinReward(bot, userId);
  }

  await bot.api('answerCallbackQuery', { callback_query_id: callbackQuery.id });

  if (data.startsWith('vault_')) {
    const page = parseInt(data.split('_')[1], 10);
    if (Number.isNaN(page)) return;
    const vault = (await bot.kv.getVault()) || [];
    await sendVaultPage(bot, chatId, vault, page, messageId);
    return;
  }

  if (data.startsWith('random_')) {
    const region = data.split('_')[1] as RegionFilter | undefined;
    const username = callbackQuery.from.username ? `@${callbackQuery.from.username}` : 'TanpaUsername';
    await bot.api('deleteMessage', { chat_id: chatId, message_id: messageId });
    await processGeneration(bot, chatId, userId, username, isAdmin, null, 'random', region || null);
    return;
  }
}