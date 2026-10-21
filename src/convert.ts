import type { Bot } from './bot';
import { escapeHtml } from './telegram';
import { sleep } from './stats';
import { extractCookieDict, extractMetadata, fetchNfToken, maskEmail } from './netflix';
import { splitAccounts } from './parse';
import { isBillingExpired } from './dateparse';
import { resolveCountry } from './countries';

const DELAY_MS = 150;

export interface ConvertSummary {
  chunks: number;
  added: number;
  dead: number;
  billingExpired: number;
  noCookie: number;
  truncated: boolean;
}

/**
 * Memproses teks cookie (1 atau banyak akun) menjadi Vault.
 *
 * Aturan:
 *  - cookie mati (gagal fetch token)        -> dibuang
 *  - Next Billing sudah lewat               -> dibuang
 *  - hanya yang aktif & billing aman        -> masuk Vault
 *  - field "Expires" diabaikan (itu masa link login, bukan masa cookie)
 */
export async function processConvert(bot: Bot, textData: string, chatId: number): Promise<void> {
  try {
    const allChunks = splitAccounts(textData);
    const limit = Math.max(1, bot.cfg.CONVERT_BATCH);
    const truncated = allChunks.length > limit;
    const chunks = truncated ? allChunks.slice(0, limit) : allChunks;

    let addedCount = 0;
    let deadCount = 0;
    let billingExpiredCount = 0;
    let noCookieCount = 0;

    const vault = (await bot.kv.getVault()) || [];
    let startId = vault.length > 0 ? vault[vault.length - 1].id + 1 : 1;

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

      // 1) Validasi cookie — kalau gagal, akun sudah tidak bisa dipakai.
      try {
        await fetchNfToken(dict.NetflixId);
      } catch {
        deadCount++;
        await sleep(DELAY_MS);
        continue;
      }

      // 2) Cookie hidup, tapi Next Billing sudah lewat -> jangan dipakai.
      if (isBillingExpired(meta.nextBilling)) {
        billingExpiredCount++;
        await sleep(DELAY_MS);
        continue;
      }

      // 3) Simpan ke Vault.
      vault.push({
        id: startId++,
        rawText: chunk.trim(),
        email: maskEmail(meta.email),
        region: meta.region,
        country: resolveCountry(meta.region) ?? undefined,
        plan: meta.plan,
        memberSince: meta.memberSince,
        nextBilling: meta.nextBilling,
      });
      addedCount++;

      await sleep(DELAY_MS);
    }

    let finalMsg = `✅ <b>Proses Convert Selesai!</b>\n\n`;
    finalMsg += `➕ <b>Masuk Vault (aktif):</b> ${addedCount} Akun\n`;
    if (deadCount > 0) finalMsg += `❌ <b>Dibuang (cookie mati):</b> ${deadCount} Akun\n`;
    if (billingExpiredCount > 0) {
      finalMsg += `⏳ <b>Dibuang (Next Billing lewat):</b> ${billingExpiredCount} Akun\n`;
    }
    if (noCookieCount > 0) finalMsg += `⚠️ <b>Dibuang (tidak ada NetflixId):</b> ${noCookieCount} Akun\n`;
    if (truncated) {
      finalMsg += `⚠️ <b>Catatan:</b> File berisi ${allChunks.length} akun, batch ini memproses ${chunks.length}. `
        + `Sisa ${allChunks.length - chunks.length} akun tidak diproses — kirim ulang sisanya.\n`;
    }
    finalMsg += `\nTotal saat ini ada <b>${vault.length}</b> akun di Vault.`;

    if (addedCount > 0) await bot.kv.setVault(vault);
    await bot.send(chatId, finalMsg);
  } catch (e) {
    await bot.send(chatId, `❌ <b>Gagal memproses data:</b>\n\n<code>${escapeHtml((e as Error).message)}</code>`);
  }
}
