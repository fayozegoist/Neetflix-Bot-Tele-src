import type { Bot } from './bot';
import type { VaultResult } from './vaultstore';
import { nowWIB, sleep } from './stats';
import { extractCookieDict, fetchNfToken, isDeadFailure } from './netflix';
import { isBillingExpired } from './dateparse';
import { refreshStats } from './vaultstats';
import { decide, loadBreaker, nextBreakerState, saveBreaker, PAUSE_MS } from './breaker';

/**
 * Validasi satu batch akun.
 *
 * Prioritas: antrean `pending` (belum pernah diperiksa) lebih dulu. Kalau
 * antrean kosong, baru sweep akun `active` yang paling lama tidak dicek.
 *
 * Aturan keselamatan: HANYA kegagalan yang pasti (`NfError` jenis `dead`) yang
 * membuat akun dihapus. Rate-limit (429), error server (5xx), timeout, dan body
 * non-JSON dihitung "ambigu" -> akun dipertahankan (tetap `active` kalau sudah
 * pernah lolos, tetap `pending` kalau belum), dan circuit breaker di
 * `breaker.ts` akan menjeda validasi kalau ambigu berturut-turut.
 */
export async function validateBatch(bot: Bot): Promise<void> {
  const state = await loadBreaker(bot);
  const decision = decide(state);

  if (!decision.run) {
    if (decision.reason === 'hard-paused' && !state.notifiedHardPause && bot.cfg.ADMIN_ID) {
      state.notifiedHardPause = true;
      await saveBreaker(bot, state);
      await bot.api('sendMessage', {
        chat_id: bot.cfg.ADMIN_ID,
        parse_mode: 'HTML',
        text:
          `🛑 <b>AUTO-VALIDASI DIHENTIKAN</b> (${nowWIB()})\n\n` +
          `Netflix berkali-kali membalas rate-limit / error, jadi validasi saya hentikan ` +
          `supaya tidak ada akun sehat yang ikut terhapus.\n\n` +
          `Buka halaman <b>/admin</b> dan tekan <b>Resume</b> setelah keadaan normal.`,
      });
    }
    return;
  }

  // Antrean pending dulu; kalau kosong baru rotasi akun aktif.
  let queue = await bot.vault.fetchPending(decision.perRun);
  const sweeping = queue.length === 0;
  if (sweeping) queue = await bot.vault.fetchStaleActive(decision.perRun);
  if (queue.length === 0) return;

  const results: VaultResult[] = [];
  let dead = 0;
  let alive = 0;
  let ambiguous = 0;

  for (const v of queue) {
    const dict = extractCookieDict(v.rawText);

    if (!dict.NetflixId) {
      results.push({ id: v.id, status: 'dead', reason: 'tanpa_cookie' });
      dead++;
      await sleep(150);
      continue;
    }

    try {
      await fetchNfToken(dict.NetflixId);
      // Hidup, tapi billing sudah lewat -> tetap tidak layak dipakai.
      if (isBillingExpired(v.nextBilling)) {
        results.push({ id: v.id, status: 'dead', reason: 'billing_lewat' });
        dead++;
      } else {
        results.push({ id: v.id, status: 'active' });
        alive++;
      }
    } catch (e) {
      if (isDeadFailure(e)) {
        results.push({ id: v.id, status: 'dead', reason: 'cookie_mati' });
        dead++;
      } else {
        // Ambigu: pertahankan status yang sudah ada, jangan turunkan pangkat
        // akun yang sudah pernah lolos verifikasi.
        results.push({ id: v.id, status: v.status === 'active' ? 'active' : 'pending', reason: 'ambigu' });
        ambiguous++;
      }
    }
    await sleep(150);
  }

  await bot.vault.applyResults(results);

  const { state: updated, action } = nextBreakerState(state, { dead, alive, ambiguous });
  await saveBreaker(bot, updated);

  if (bot.cfg.ADMIN_ID && action === 'pause') {
    const menit = Math.round(PAUSE_MS / 60000);
    await bot.api('sendMessage', {
      chat_id: bot.cfg.ADMIN_ID,
      parse_mode: 'HTML',
      text:
        `⏸️ <b>Validasi dijeda sementara</b> (${nowWIB()})\n\n` +
        `Netflix membalas rate-limit / error <b>${ambiguous}×</b> pada batch terakhir, ` +
        `jadi validasi saya jeda <b>${menit} menit</b> dan laju diturunkan ke ` +
        `<b>${updated.perRun} akun/run</b>.\n\n` +
        `<i>Akun yang error ambigu TIDAK dihapus.</i>`,
    });
  }

  if (action === 'hard-pause' && bot.cfg.ADMIN_ID && !updated.notifiedHardPause) {
    updated.notifiedHardPause = true;
    await saveBreaker(bot, updated);
  }

  // Akun mati disimpan sebentar untuk laporan, lalu dipangkas.
  if (sweeping) {
    try {
      await bot.vault.pruneDead(bot.cfg.DEAD_RETENTION_MS);
    } catch {
      // pemangkasan bukan hal kritis
    }
  }

  // Antrean habis? Beri tahu admin sekali. `pendingCount()` murah, jadi
  // pengambilan rekap lengkap (yang memindai tabel) hanya terjadi sekali ini.
  if (!sweeping && bot.cfg.ADMIN_ID && dead + alive + ambiguous > 0) {
    try {
      const pending = await bot.vault.pendingCount();
      if (pending === 0) {
        const counts = (await refreshStats(bot)).counts;
        await bot.api('sendMessage', {
          chat_id: bot.cfg.ADMIN_ID,
          parse_mode: 'HTML',
          text:
            `🎉 <b>ANTREAN VALIDASI SELESAI</b> (${nowWIB()})\n\n` +
            `✅ Siap dipakai: <b>${counts.active}</b> akun\n` +
            `🗑️ Dibuang total: <b>${counts.dead}</b> akun\n` +
            `⚙️ Laju validasi: <b>${updated.perRun} akun/run</b>`,
        });
      }
    } catch {
      // abaikan
    }
  }
}
