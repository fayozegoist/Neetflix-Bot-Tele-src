import type { Bot } from './bot';
import { nowWIB, sleep } from './stats';
import { extractCookieDict, fetchNfToken } from './netflix';

export async function validateBatch(bot: Bot): Promise<void> {
  const vault = (await bot.kv.getVault()) || [];
  if (vault.length === 0) return;

  const batch = Math.max(1, bot.cfg.BATCH_SIZE);
  let cursor = await bot.kv.getCursor('validate_cursor');
  if (cursor < 0 || cursor >= vault.length) cursor = 0;

  const slice = vault.slice(cursor, cursor + batch);
  const deadIds = new Set<number>();

  for (const v of slice) {
    let ok = false;
    try {
      const dict = extractCookieDict(v.rawText);
      if (dict.NetflixId) {
        await fetchNfToken(dict.NetflixId);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) deadIds.add(v.id);
    await sleep(200);
  }

  let remainingVault = vault;
  let removed = 0;
  if (deadIds.size > 0) {
    remainingVault = vault.filter((v) => !deadIds.has(v.id));
    await bot.kv.setVault(remainingVault);
    removed = deadIds.size;
  }

  const total = remainingVault.length;
  let next = cursor + batch;
  let sweepDone = false;
  if (next >= total) {
    next = 0;
    sweepDone = true;
  }
  await bot.kv.setCursor('validate_cursor', next);

  if (sweepDone && bot.cfg.ADMIN_ID) {
    const remaining = vault.length - removed;
    await bot.api('sendMessage', {
      chat_id: bot.cfg.ADMIN_ID,
      text:
        `🧹 <b>AUTO-VALIDASI SELESAI</b> (${nowWIB()})\n\n` +
        `🗑️ Akun mati dihapus pada batch terakhir: <b>${removed}</b>\n` +
        `📦 Sisa akun: <b>${remaining}</b>`,
      parse_mode: 'HTML',
    });
  }
}