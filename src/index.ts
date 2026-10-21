import type { Env, TgUpdate } from './types';
import { readConfig } from './config';
import { KVStore } from './kv';
import { D1VaultRepo } from './vaultrepo';
import { Bot } from './bot';
import { handleMessage } from './handlers/message';
import { handleCallbackQuery } from './handlers/callback';
import { handleAdmin } from './admin';
import { validateBatch } from './validate';
import { processBroadcastBatch } from './broadcast';
import { tg } from './telegram';

const makeBot = (env: Env): Bot =>
  new Bot(readConfig(env), new KVStore(env.Neetflix_KV), new D1VaultRepo(env.VAULT_DB));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const bot = makeBot(env);
    const cfg = bot.cfg;
    const url = new URL(request.url);

    // Halaman upload massal + progress (dikunci ADMIN_WEB_KEY).
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return handleAdmin(request, bot, url);
    }

    if (url.pathname === '/setwebhook') {
      const key = url.searchParams.get('key') || '';
      const expected = cfg.SETUP_KEY || cfg.SECRET_TOKEN;
      if (!expected) {
        return new Response('Forbidden: SETUP_KEY / SECRET_TOKEN belum di-set.', { status: 401 });
      }
      if (key !== expected) {
        return new Response('Forbidden: key salah.', { status: 401 });
      }
      const host = url.searchParams.get('host') || request.headers.get('host') || '';
      const webhookUrl = `https://${host}${cfg.WEBHOOK_PATH}`;
      const setPayload: Record<string, unknown> = { url: webhookUrl };
      if (cfg.SECRET_TOKEN) setPayload.secret_token = cfg.SECRET_TOKEN;
      const result = await tg(cfg, 'setWebhook', setPayload);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST' && (url.pathname === cfg.WEBHOOK_PATH || url.pathname === '/')) {
      // Fail-closed: tanpa SECRET_TOKEN, semua request webhook ditolak.
      if (!cfg.SECRET_TOKEN) {
        return new Response('Forbidden: SECRET_TOKEN belum di-set.', { status: 401 });
      }
      const headerToken = request.headers.get('x-telegram-bot-api-secret-token');
      if (headerToken !== cfg.SECRET_TOKEN) {
        return new Response('Forbidden', { status: 401 });
      }
      try {
        const update = (await request.json()) as TgUpdate;
        if (update.message) {
          await handleMessage(bot, update.message);
        } else if (update.callback_query) {
          await handleCallbackQuery(bot, update.callback_query);
        }
      } catch (err) {
        console.error('Error processing update:', err);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response(
      JSON.stringify({ status: 'ok', bot: 'MEDIAFAIRY (Cloudflare Worker)', time: new Date().toISOString() }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const bot = makeBot(env);
    if (!bot.cfg.BOT_TOKEN) return;

    // Hanya SATU job berat per tick: free plan membatasi 50 subrequest per
    // eksekusi, dan tiap validasi akun memakai 1 subrequest ke Netflix.
    //
    // 1) Antrean validasi (paling penting, supaya akun baru cepat siap pakai)
    // 2) Broadcast yang belum selesai
    // 3) Rotasi sweep akun aktif
    try {
      // `hasPending()` berhenti di baris pending pertama — biayanya 1 baris,
      // bukan 5000. Inilah yang membuat cron tiap menit tetap aman terhadap
      // kuota 5 juta baris-baca/hari D1 free plan.
      if (await bot.vault.hasPending()) {
        await validateBatch(bot);
        return;
      }
    } catch (e) {
      console.error('cek antrean validasi gagal:', (e as Error).message);
    }

    const hadPending = await bot.kv.getPendingMessage('bcast_pending').catch(() => null);
    if (hadPending) {
      try {
        await processBroadcastBatch(bot);
      } catch (e) {
        console.error('processBroadcastBatch error:', (e as Error).message);
      }
      return;
    }

    // Sweep akun aktif tiap 5 menit saja, supaya tidak menghabiskan kuota.
    if (new Date().getUTCMinutes() % 5 === 0) {
      try {
        await validateBatch(bot);
      } catch (e) {
        console.error('validateBatch error:', (e as Error).message);
      }
    }
  },
};
