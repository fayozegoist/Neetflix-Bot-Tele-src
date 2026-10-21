import type { Bot } from '../bot';
import type { Stats, TgDocument, TgMessage } from '../types';
import { escapeHtml } from '../telegram';
import { getStats, getWIBDate, nowWIB, registerUser } from '../stats';
import { isChannelMember, joinGateMarkup, markVerified } from '../gate';
import { countryMarkup, mainMenu } from '../menu';
import { sendVaultPage } from '../vault';
import { handleDonasi } from '../donation';
import { processConvert } from '../convert';
import { BROADCAST_BATCH, processBroadcastBatch } from '../broadcast';

const deny = (bot: Bot, chatId: number, text: string) => bot.send(chatId, text);

const cooldownSec = (bot: Bot): number => Math.round(bot.cfg.COOLDOWN_MS / 1000);

/** Teks pembuka menu pilih negara (satu-satunya jalur generate). */
const COUNTRY_MENU_TEXT =
  '🌍 <b>Pilih Negara Akun</b>\n\n' +
  'Tekan tombol negara untuk generate token secara acak dari stok negara tersebut.\n\n' +
  'Ingin dari negara mana saja? Pilih <b>🎲 Semua Negara</b>.';

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

  // --- Gate join channel (wajib, admin exempt) ---
  if (!isAdmin && bot.cfg.CHANNEL_ID) {
    const member = await isChannelMember(bot, userId);
    if (!member) {
      await bot.send(
        chatId,
        `🔒 <b>Akses Terkunci</b>\n\n` +
          `Untuk menggunakan bot, wajib <b>join channel</b> kami dulu:\n` +
          (bot.cfg.CHANNEL_URL ? `👉 <a href="${bot.cfg.CHANNEL_URL}">${bot.cfg.CHANNEL_URL}</a>\n\n` : '') +
          `Setelah join, tekan tombol <b>Verifikasi</b> di bawah.`,
        { markup: joinGateMarkup(bot.cfg) }
      );
      return;
    }
    await markVerified(bot, userId);
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

  if (isAdmin && text.startsWith('/resetcooldown ')) {
    const targetId = parseInt(text.split(' ')[1], 10);
    if (targetId) {
      const targetStats = await getStats(bot, targetId);
      targetStats.lastGen = 0;
      await bot.kv.setStats(targetId, targetStats);
      await bot.send(chatId, `✅ <b>Berhasil!</b> Cooldown ID: <code>${targetId}</code> direset.`);
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
    let verified = 0;
    const statKeys = await bot.kv.listKeys('stats_');
    for (const k of statKeys) {
      const s = await bot.kv.getJson<Stats>(k);
      if (s && (s.verified || s.joinRewarded)) verified++;
    }
    await bot.send(
      chatId,
      `📊 <b>STATISTIK SERVER</b>\n\n` +
        `📁 Vault: <b>${vault.length}</b> akun\n` +
        `👥 User terdaftar: <b>${users.length}</b>\n` +
        `✅ Terverifikasi join: <b>${verified}</b> user\n` +
        `🗑️ Auto-validasi: batch ${bot.cfg.BATCH_SIZE} akun per run\n` +
        `🔄 Convert batch: ${bot.cfg.CONVERT_BATCH} akun per file\n` +
        `🕐 Waktu: ${nowWIB()}`
    );
    return;
  }

  if (text === '/start') {
    await bot.send(
      chatId,
      `👋 <b>Selamat datang di MEDIAFAIRY Netflix Token!</b>\n\n` +
        `Bot ini dapat memberikan Anda <i>Token Auto-Login Netflix</i> secara instan.\n\n` +
        `✨ <b>Tanpa batas kuota</b> — dengan jeda <b>${cooldownSec(bot)} detik</b> antar generate.\n\n` +
        `📢 Wajib <b>join channel</b> kami & verifikasi sebelum bisa generate.\n\n` +
        `👇 <b>Silakan pilih menu di bawah ini:</b>`,
      { markup: mainMenu(isAdmin) }
    );
    return;
  }

  if (text === '🎲 Generate Token') {
    await bot.send(chatId, COUNTRY_MENU_TEXT, { markup: countryMarkup(0) });
    return;
  }

  // Label keyboard versi lama (sebelum dua tombol generate digabung).
  // Telegram menyimpan reply-keyboard di perangkat sampai bot mengirim yang
  // baru, jadi user yang belum menekan /start masih melihat tombol lama.
  if (text === '🔑 Generate Token' || text === '🎲 Generate Random') {
    await bot.send(
      chatId,
      '♻️ <b>Menu sudah diperbarui.</b>\n\n' +
        'Sekarang cukup satu tombol: <b>🎲 Generate Token</b>.\n' +
        'Keyboard di perangkat Anda sudah diganti — silakan tekan tombol di bawah ini. 👇',
      { markup: mainMenu(isAdmin) }
    );
    return;
  }

  if (text === '🔄 Convert Netscape') {
    if (!isAdmin) return void (await deny(bot, chatId, '⛔ <b>Akses Ditolak.</b>'));
    await bot.send(chatId, '🔄 <b>Menu Convert (Admin Only)</b>\n\nData otomatis di-<b>verifikasi</b>. Cookie mati atau Next Billing sudah lewat akan <b>otomatis dibuang</b>. Hanya akun aktif yang masuk ke Vault Global.\n\n1. Manual: <code>/conv [teks_cookie]</code>2. Massal: <b>Kirimkan file .txt</b>');
    return;
  }

  if (text === '📁 Vault Tersimpan') {
    const vault = (await bot.kv.getVault()) || [];
    await sendVaultPage(bot, chatId, vault, 0);
    return;
  }

  if (text === '📊 Cek Limit') {
    const stats = await getStats(bot, userId);
    const cooldown = bot.cfg.COOLDOWN_MS;
    const remainMs = stats.lastGen ? Math.max(0, cooldown - (Date.now() - stats.lastGen)) : 0;
    const remainSec = Math.ceil(remainMs / 1000);
    const cooldownText = remainMs > 0 ? `⏳ <b>${remainSec} detik</b> lagi` : '✅ <b>Siap</b> (generate sekarang)';
    const verifyStatus = stats.verified || stats.joinRewarded ? '✅ Sudah verifikasi' : '❌ Belum verifikasi';
    await bot.send(
      chatId,
      `📊 <b>Status MEDIAFAIRY</b>\n\n` +
        `📅 <b>Tanggal:</b> ${getWIBDate()} (WIB)\n\n` +
        `♾️ <b>Kuota:</b> Unlimited (tanpa batas)\n` +
        `⏱ <b>Cooldown:</b> ${cooldownSec(bot)} detik antar generate\n` +
        `⏳ <b>Sisa cooldown:</b> ${cooldownText}\n` +
        `📢 <b>Join Channel:</b> ${verifyStatus}\n\n` +
        `<i>Generate bebas, asal tidak lebih dari 1x per ${cooldownSec(bot)} detik.</i>`
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
        `🔄 Reset Cooldown: <code>/resetcooldown [ID_USER]</code>\n` +
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

  if (/^\/conv(\s|$)/.test(text)) {
    if (!isAdmin) return void (await deny(bot, chatId, '⛔ <b>Akses Ditolak.</b>'));
    await processConvert(bot, text.replace(/^\/conv/, '').trim(), chatId);
    return;
  }

  // Command lama yang sudah dihapus: arahkan ke menu tombol, jangan didiamkan.
  if (/^\/(gen|generate)\b/i.test(text)) {
    await bot.send(
      chatId,
      'ℹ️ Command <code>/gen</code> sudah <b>tidak tersedia</b>.\n\n' +
        'Sekarang generate token lewat <b>tombol menu</b>: tekan <b>🎲 Generate Token</b> ' +
        'lalu pilih negaranya.',
      { markup: mainMenu(isAdmin) }
    );
    return;
  }
}
