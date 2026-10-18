import type { Bot } from './bot';
import { escapeHtml } from './telegram';
import { sleep } from './stats';
import { extractCookieDict, extractMetadata, fetchNfToken, maskEmail } from './netflix';

const CONVERT_BATCH = 40;

export async function processConvert(bot: Bot, textData: string, chatId: number): Promise<void> {
  try {
    let normalized = textData.replace(/\r\n/g, '\n');
    const delimiter = '|||MEDIAFAIRY_SPLIT|||';
    normalized = normalized.replace(/(^|\n)(?=(?:#\s*)?Email\s*:)/gi, `$1${delimiter}`);

    let chunks = normalized.split(delimiter).filter((c) => c.trim().length > 0);
    if (chunks.length === 1 && !/(?:#\s*)?Email\s*:/i.test(chunks[0])) {
      const altChunks = chunks[0].split(/\n\s*\n/);
      if (altChunks.length > 1) chunks = altChunks;
    }

    let truncated = false;    if (chunks.length > CONVERT_BATCH) {
      chunks = chunks.slice(0, CONVERT_BATCH);
      truncated = true;
    }

    let addedCount = 0;
    let failedCount = 0;
    const vault = (await bot.kv.getVault()) || [];
    let startId = vault.length > 0 ? vault[vault.length - 1].id + 1 : 1;

    await bot.send(chatId, `🔄 Sedang memverifikasi JSON & Menyaring Region Global (batch ${chunks.length} akun), mohon tunggu...`);

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const dict = extractCookieDict(chunk);
      if (dict.NetflixId) {
        const meta = extractMetadata(chunk);
        try {
          await fetchNfToken(dict.NetflixId);
          vault.push({
            id: startId++,
            rawText: chunk.trim(),
            email: maskEmail(meta.email),
            region: meta.region,
            plan: meta.plan,
            memberSince: meta.memberSince,
            nextBilling: meta.nextBilling,
          });
          addedCount++;
        } catch {
          failedCount++;
        }
        await sleep(250);
      }
    }

    let finalMsg = `✅ <b>Proses Convert Selesai!</b>\n\n➕ <b>Masuk Vault (Valid):</b> ${addedCount} Akun\n`;
    if (failedCount > 0) finalMsg += `❌ <b>Dibuang (Mati):</b> ${failedCount} Akun\n`;
    if (truncated) finalMsg += `⚠️ <b>Catatan:</b> Data lebih dari ${CONVERT_BATCH} akun — sisanya tidak diproses dalam batch ini. Silakan kirim ulang file/lanjutan untuk batch berikutnya.\n`;
    finalMsg += `\nTotal saat ini ada <b>${vault.length}</b> akun di Vault.`;

    if (addedCount > 0 || failedCount > 0) {
      if (addedCount > 0) await bot.kv.setVault(vault);
      await bot.send(chatId, finalMsg);
    } else {
      await bot.send(chatId, '❌ <b>Gagal:</b> Tidak ditemukan NetflixId yang valid.');
    }
  } catch (e) {
    await bot.send(chatId, `❌ <b>Gagal memproses data:</b>\n\n<code>${escapeHtml((e as Error).message)}</code>`);
  }
}