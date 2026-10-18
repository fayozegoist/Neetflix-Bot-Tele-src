import type { Bot } from '../bot';
import type { Stats, TgDocument, TgMessage } from '../types';
import { escapeHtml } from '../telegram';
import { getStats, getWIBDate, nowWIB, registerUser } from '../stats';
import { grantJoinReward, isChannelMember, joinGateMarkup, JOIN_REWARD } from '../gate';
import { mainMenu, regionMarkup } from '../menu';
import { sendVaultPage } from '../vault';
import { handleDonasi } from '../donation';
import { processGeneration } from '../generate';
import { processConvert } from '../convert';
import { BROADCAST_BATCH, processBroadcastBatch } from '../broadcast';

const deny = (bot: Bot, chatId: number, text: string) => bot.send(chatId, text);

export async function handleMessage(bot: Bot, message: TgMessage): Promise<void> {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const username = message.from.username ? `@${message.from.username}` : 'TanpaUsername';
  const text = message.text || '';
  const document: TgDocument | undefined = message.document;
  const isAdmin = bot.isAdmin(userId);

  if (!bot.cfg.BOT_TOKEN) {
    await bot.send(chatId, '⚠️ <b>Error:</b> <code>BOT_TOKEN</code> belum diatur. (wrangler secret put BOT_TOKEN)');
    return;
  }

  if (!isAdmin) await registerUser(bot, userId, username);

  if (!isAdmin && bot.cfg.CHANNEL_ID) {
    const member = await isChannelMember(bot, userId);
    if (!member) {
      await bot.send(
        chatId,
        `🔒 <b>Akses Terkunci</b>\n\n` +
          `Untuk menggunakan bot, wajib <b>join channel</b> kami dulu:\n` +
          (bot.cfg.CHANNEL_URL ? `👉 <a href="${bot.cfg.CHANNEL_URL}">${bot.cfg.CHANNEL_URL}</a>\n\n` : '') +
          `Setelah join, tekan tombol <b>Verifikasi</b> di bawah.\n\n` +
          `🎁 <b>Reward:</b> Dapatkan <b>+${JOIN_REWARD} kuota ekstra</b> (sekali) setelah verifikasi berhasil!`,
        { markup: joinGateMarkup(bot.cfg) }
      );
      return;
    }
    const granted = await grantJoinReward(bot, userId);
    if (granted) {
      await bot.send(chatId, `🎁 <b>Reward Join!</b> Anda mendapat bonus <b>+${granted} kuota ekstra</b> (sekali).`);
    }
  }

  if (text === '/clearvault') {
    if (!isAdmin) return void (await deny(bot, chatId, '⛔ <b>Akses Ditolak:</b> Anda bukan Admin.'));
    await bot.kv.setVault([]);
    await bot.send(chatId, '✅ <b>Berhasil:</b> Seluruh data pada Folder Vault Global telah dikosongkan.');
    return;
  }

  if (text.startsWith('/del ')) {
    if (!isAdmin) return void (await deny(bot, chatId, '⛔ <b>Akses Ditolak.</b>'));
    const delId = parseInt(text.split(' ')[1], 10);
    if (!delId) {
      await bot.send(chatId, '❌ Format salah. Gunakan: <code>/del [ID]</code>');
      return;
    }
    const vault = (await bot.kv.getVault()) || [];
    const initialLength = vault.length;
    const filtered = vault.filter((v) => v.id !== delId);
    if (filtered.length === initialLength) {
      await bot.send(chatId, `❌ Akun ID <b>${delId}</b> tidak ditemukan.`);
      return;
    }
    await bot.kv.setVault(filtered);
    await bot.send(chatId, `✅ <b>Berhasil:</b> Akun ID <b>${delId}</b> dihapus.`);
    return;
  }

  if (isAdmin && text.startsWith('/addquota ')) {
    const parts = text.split(' ');
    const targetId = parseInt(parts[1], 10);
    const amount = parseInt(parts[2], 10);
    if (targetId && amount) {
      const targetStats = await getStats(bot, targetId);
      targetStats.extra = (targetStats.extra || 0) + amount;
      await bot.kv.setStats(targetId, targetStats);
      await bot.send(chatId, `✅ <b>Berhasil!</b> Ditambahkan ${amount} kuota ekstra untuk ID: <code>${targetId}</code>.`);
      await bot.send(targetId, `🎉 <b>Kabar Baik!</b> Admin telah menambahkan <b>${amount}</b> kuota ekstra ke akun Anda.`);
    } else {
      await bot.send(chatId, '❌ Format salah. Gunakan: <code>/addquota [ID_USER] [JUMLAH]</code>');
    }
    return;
  }

  if (isAdmin && text.startsWith('/resetlimit ')) {
    const targetId = parseInt(text.split(' ')[1], 10);
    if (targetId) {
      const targetStats = await getStats(bot, targetId);
      targetStats.used = 0;
      await bot.kv.setStats(targetId, targetStats);
      await bot.send(chatId, `✅ <b>Berhasil!</b> Limit ID: <code>${targetId}</code> direset.`);
    }
    return;
  }

  if (isAdmin && text.startsWith('/broadcast ')) {
    const pesan = escapeHtml(text.replace('/broadcast', '').trim());
    if (!pesan) {
      await bot.send(chatId, '❌ Format salah. Gunakan: <code>/broadcast [PESAN]</code>');
      return;
    }
    const users = (await bot.kv.getUsers()) || [];
    await bot.kv.put('bcast_pending', pesan);
    await bot.kv.put('bcast_cursor', '0');
    if (users.length === 0) {
      await bot.kv.del('bcast_pending');
      await bot.kv.del('bcast_cursor');
      await bot.send(chatId, '📭 Belum ada user terdaftar.');
      return;
    }
    if (users.length <= BROADCAST_BATCH) {
      await processBroadcastBatch(bot);
    } else {
      await bot.send(chatId, `📢 <b>Broadcast dimulai.</b>\n👥 Total user: ${users.length}\nPengiriman bertahap ${BROADCAST_BATCH}/run (tiap ~30 menit) agar tidak melewati batas free plan.`);
    }
    return;
  }

  if (isAdmin && text === '/stats') {
    const vault = (await bot.kv.getVault()) || [];
    const users = (await bot.kv.getUsers()) || [];
    let rewarded = 0;
    const statKeys = await bot.kv.listKeys('stats_');
    for (const k of statKeys) {
      const s = await bot.kv.getJson<Stats>(k);
      if (s && s.joinRewarded) rewarded++;
    }
    await bot.send(
      chatId,
      `📊 <b>STATISTIK SERVER</b>\n\n` +
        `📁 Vault: <b>${vault.length}</b> akun\n` +
        `👥 User terdaftar: <b>${users.length}</b>\n` +
        `🎁 Reward join: <b>${rewarded}</b> user\n` +
        `🗑️ Auto-validasi: batch ${bot.cfg.BATCH_SIZE} akun per run\n` +
        `🕐 Waktu: ${nowWIB()}`
    );
    return;
  }

  if (text === '/start') {
    await bot.send(
      chatId,
      `👋 <b>Selamat datang di MEDIAFAIRY Netflix Token!</b>\n\n` +
        `Bot ini dapat memberikan Anda <i>Token Auto-Login Netflix</i> secara instan.\n\n` +
        `Setiap user memiliki kuota gratis <b>${bot.cfg.FREE_DAILY_LIMIT}x Generate per hari</b> (Reset setiap pukul 00:00 WIB), dengan jeda <b>1 menit</b> antar generate.\n\n` +
        `🎁 Join channel kami & verifikasi untuk bonus <b>+${JOIN_REWARD} kuota ekstra</b> (sekali).\n\n` +
        `👇 <b>Silakan pilih menu di bawah ini:</b>`,
      { markup: mainMenu(isAdmin) }
    );
    return;
  }

  if (text === '🔑 Generate Token') {
    await bot.send(chatId, '🛠️ <b>Menu Generate Token</b>\n\n<b>Cara Penggunaan:</b>\n1. Dari teks manual: Kirim <code>/gen [teks_cookie]</code>\n2. Dari ID Vault: Kirim <code>/gen [nomor_id]</code>');
    return;
  }

  if (text === '🔄 Convert Netscape') {
    if (!isAdmin) return void (await deny(bot, chatId, '⛔ <b>Akses Ditolak.</b>'));
    await bot.send(chatId, '🔄 <b>Menu Convert Netscape (Admin Only)</b>\n\nData otomatis di-<b>verifikasi</b>. Jika valid, akan masuk ke Vault Global.\n\n1. Manual: <code>/conv [teks_netscape]</code>\n2. Massal: <b>Kirimkan file .txt</b>');
    return;
  }

  if (text === '📁 Vault Tersimpan') {
    const vault = (await bot.kv.getVault()) || [];
    await sendVaultPage(bot, chatId, vault, 0);
    return;
  }

  if (text === '📊 Cek Limit') {
    const stats = await getStats(bot, userId);
    const sisaBase = Math.max(bot.cfg.FREE_DAILY_LIMIT - stats.used, 0);
    const sisaExtra = stats.extra || 0;
    const rewardStatus = stats.joinRewarded
      ? `✅ Sudah (reward +${JOIN_REWARD} diberikan)`
      : `❌ Belum — join channel & verifikasi untuk +${JOIN_REWARD}`;
    await bot.send(
      chatId,
      `📊 <b>Informasi Limit MEDIAFAIRY</b>\n\n` +
        `📅 <b>Tanggal:</b> ${getWIBDate()} (WIB)\n\n` +
        `🔄 <b>Limit Gratis:</b> ${sisaBase}/${bot.cfg.FREE_DAILY_LIMIT}\n` +
        `💎 <b>Kuota Ekstra:</b> ${sisaExtra}\n` +
        `🎁 <b>Reward Join:</b> ${rewardStatus}\n\n` +
        `⏱ <b>Jeda Generate:</b> 1 menit antar generate`
    );
    return;
  }

  if (text === '💳 Donasi') {
    await handleDonasi(bot, chatId);
    return;
  }

  if (text === '⚙️ Panel Admin' && isAdmin) {
    await bot.send(
      chatId,
      `⚙️ <b>Panel Kontrol Admin</b>\n\n` +
        `🗑️ Hapus Vault: <code>/clearvault</code>\n` +
        `🗑️ Hapus 1 Akun: <code>/del [ID]</code>\n` +
        `➕ Tambah Kuota: <code>/addquota [ID_USER] [JUMLAH]</code>\n` +
        `🔄 Reset Limit: <code>/resetlimit [ID_USER]</code>\n` +
        `📢 Broadcast: <code>/broadcast [PESAN]</code>\n` +
        `📊 Stats Server: <code>/stats</code>`
    );
    return;
  }

  if (document) {
    if (!isAdmin) return void (await deny(bot, chatId, '⛔ <b>Akses Ditolak.</b>'));
    if (document.mime_type === 'text/plain' || (document.file_name && document.file_name.endsWith('.txt'))) {
      await bot.send(chatId, '🔄 Mengunduh dan memproses file ke Vault Global...');
      try {
        const fileRes = await bot.api<{ file_path: string }>('getFile', { file_id: document.file_id });
        if (!fileRes.ok || !fileRes.result) throw new Error('Gagal mengambil file.');
        const filePath = fileRes.result.file_path;
        const fileContentRes = await fetch(`https://api.telegram.org/file/bot${bot.cfg.BOT_TOKEN}/${filePath}`);
        const fileText = await fileContentRes.text();
        await processConvert(bot, fileText, chatId);
      } catch (e) {
        await bot.send(chatId, `❌ <b>Gagal memproses file:</b>\n<code>${escapeHtml((e as Error).message)}</code>`);
      }
    } else {
      await bot.send(chatId, '❌ Hanya file <b>.txt</b> yang diperbolehkan.');
    }
    return;
  }

  if (text === '🎲 Generate Random') {
    await bot.send(chatId, '🌍 <b>Pilih Region Akun:</b>\nSilakan pilih spesifikasi wilayah untuk akun yang ingin Anda generate.', { markup: regionMarkup() });
    return;
  }

  if (/^\/conv(\s|$)/.test(text)) {
    if (!isAdmin) return void (await deny(bot, chatId, '⛔ <b>Akses Ditolak.</b>'));
    await processConvert(bot, text.replace(/^\/conv/, '').trim(), chatId);
    return;
  }

  if (/^\/gen(\s|$)/.test(text)) {
    const inputData = text.replace(/^\/gen/, '').trim();
    if (!inputData) {
      await bot.send(chatId, '❌ <b>Format salah.</b>\nGunakan: <code>/gen [teks/nomor_id]</code>');
      return;
    }
    await processGeneration(bot, chatId, userId, username, isAdmin, inputData, 'gen', null);
    return;
  }
}