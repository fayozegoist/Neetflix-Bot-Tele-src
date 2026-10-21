import type { Env, TgUpdate } from './types';
import { readConfig } from './config';
import { KVStore } from './kv';
import { Bot } from './bot';
import { handleMessage } from './handlers/message';
import { handleCallbackQuery } from './handlers/callback';
import { validateBatch } from './validate';
import { processBroadcastBatch } from './broadcast';
import { tg } from './telegram';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const bot = new Bot(readConfig(env), new KVStore(env.Neetflix_KV));
    const cfg = bot.cfg;
    const url = new URL(request.url);

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
    const bot = new Bot(readConfig(env), new KVStore(env.Neetflix_KV));
    if (!bot.cfg.BOT_TOKEN) return;

    // Broadcast DAN validasi tidak boleh jalan bersamaan: total subrequest
    // bisa melebihi batas 50 subrequest per eksekusi pada free plan.
    const hadPending = await bot.kv.getPendingMessage('bcast_pending').catch(() => null);
    if (hadPending) {
      try {
        await processBroadcastBatch(bot);
      } catch (e) {
        console.error('processBroadcastBatch error:', (e as Error).message);
      }
      return; // broadcast berjalan -> skip validasi di run ini
    }

    try {
      await validateBatch(bot);
    } catch (e) {
      console.error('validateBatch error:', (e as Error).message);
    }
  },
};
