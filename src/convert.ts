import type { Bot } from './bot';
import type { NewVaultRow } from './vaultstore';
import { escapeHtml } from './telegram';
import { sleep } from './stats';
import { extractCookieDict, extractMetadata, fetchNfToken, isDeadFailure, maskEmail } from './netflix';
import { splitAccounts } from './parse';
import { isBillingExpired } from './dateparse';
import { resolveCountry } from './countries';
import { cookieHash } from './hash';
import { refreshStats } from './vaultstats';

const DELAY_MS = 150;

export interface ConvertSummary {
  chunks: number;
  added: number;
  duplicate: number;
  pending: number;
  dead: number;
  billingExpired: number;
  noCookie: number;
  truncated: boolean;
}

/**
 * Memproses teks cookie (1 atau banyak akun) menjadi Vault.
 *
 * Aturan:
 *  - cookie mati (Netflix menjawab normal tanpa token)  -> dibuang
 *  - Next Billing sudah lewat                           -> dibuang
 *  - aktif & billing aman                               -> masuk Vault sebagai `active`
 *  - ambigu (rate-limit / 5xx / timeout)                -> masuk sebagai `pending`,
 *    divalidasi ulang oleh cron; akun TIDAK dibuang dan tidak bisa di-generate dulu
 *  - field "Expires" diabaikan (masa link login, bukan masa cookie)
 */
export async function processConvert(bot: Bot, textData: string, chatId: number): Promise<void> {
  try {
    const allChunks = splitAccounts(textData);
    const limit = Math.max(1, bot.cfg.CONVERT_BATCH);
    const truncated = allChunks.length > limit;
    const chunks = truncated ? allChunks.slice(0, limit) : allChunks;

    let deadCount = 0;
    let billingExpiredCount = 0;
    let noCookieCount = 0;
    const rows: NewVaultRow[] = [];

    await bot.send(
      chatId,
      `🔄 Memverifikasi <b>${chunks.length}</b> akun (cek cookie + Next Billing), mohon tunggu...`
    );

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const dict = extractCookieDict(chunk);
      if (!dict.NetflixId) {
        noCookieCount++;
        continue;
      }

      const meta = extractMetadata(chunk);
      const row = {
        cookieHash: await cookieHash(dict.NetflixId),
        rawText: chunk.trim(),
        email: maskEmail(meta.email),
        region: meta.region,
        country: resolveCountry(meta.region) ?? null,
        plan: meta.plan,
        memberSince: meta.memberSince,
        nextBilling: meta.nextBilling,
      };

      // 1) Validasi cookie.
      try {
        await fetchNfToken(dict.NetflixId);
      } catch (e) {
        if (isDeadFailure(e)) {
          deadCount++;
        } else {
          // Rate-limit / timeout BUKAN bukti mati: simpan sebagai `pending`
          // supaya cron memvalidasinya nanti. Tidak dibuang, tidak dilayani dulu.
          rows.push({ ...row, status: 'pending' });
        }
        await sleep(DELAY_MS);
        continue;
      }

      // 2) Cookie hidup, tapi Next Billing sudah lewat -> jangan dipakai.
      if (isBillingExpired(meta.nextBilling)) {
        billingExpiredCount++;
        await sleep(DELAY_MS);
        continue;
      }

      // 3) Simpan sebagai aktif.
      rows.push({ ...row, status: 'active' });
      await sleep(DELAY_MS);
    }

    const inserted = rows.length > 0 ? await bot.vault.insertMany(rows) : 0;
    const addedCount = rows.filter((r) => r.status === 'active').length;
    const pendingCount = rows.filter((r) => r.status === 'pending').length;
    const duplicate = rows.length - inserted;

    let totalActive = 0;
    try {
      // Satu kali pindai tabel untuk menampilkan total setelah convert.
      totalActive = (await refreshStats(bot)).counts.active;
    } catch {
      totalActive = addedCount;
    }

    let finalMsg = `✅ <b>Proses Convert Selesai!</b>\n\n`;
    finalMsg += `➕ <b>Masuk Vault (aktif):</b> ${addedCount} Akun\n`;
    if (duplicate > 0) finalMsg += `♻️ <b>Dilewati (sudah ada di Vault):</b> ${duplicate} Akun\n`;
    if (deadCount > 0) finalMsg += `❌ <b>Dibuang (cookie mati):</b> ${deadCount} Akun\n`;
    if (billingExpiredCount > 0) {
      finalMsg += `⏳ <b>Dibuang (Next Billing lewat):</b> ${billingExpiredCount} Akun\n`;
    }
    if (noCookieCount > 0) finalMsg += `⚠️ <b>Dibuang (tidak ada NetflixId):</b> ${noCookieCount} Akun\n`;
    if (pendingCount > 0) {
      finalMsg += `🌐 <b>Menunggu validasi ulang (Netflix membatasi):</b> ${pendingCount} Akun\n`;
    }
    if (truncated) {
      finalMsg +=
        `⚠️ <b>Catatan:</b> File berisi ${allChunks.length} akun, batch ini memproses ${chunks.length}. ` +
        `Sisa ${allChunks.length - chunks.length} akun tidak diproses — kirim ulang sisanya.\n`;
    }
    finalMsg += `\nTotal akun <b>siap dipakai</b> di Vault: <b>${totalActive}</b>.`;
    if (pendingCount > 0) {
      finalMsg +=
        `\n\n🔁 <b>${pendingCount} akun tidak dibuang</b> — Netflix sedang membatasi, jadi belum bisa ` +
        `dipastikan hidup atau mati. Akun itu masuk antrean dan akan divalidasi otomatis, ` +
        `jadi tidak perlu kirim ulang.`;
    }

    await bot.send(chatId, finalMsg);
  } catch (e) {
    await bot.send(chatId, `❌ <b>Gagal memproses data:</b>\n\n<code>${escapeHtml((e as Error).message)}</code>`);
  }
}
