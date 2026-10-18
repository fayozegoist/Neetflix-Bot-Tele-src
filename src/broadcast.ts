import type { Bot } from './bot';
import { sleep } from './stats';

export const BROADCAST_BATCH = 40;

export async function processBroadcastBatch(bot: Bot): Promise<void> {
  const pesan = await bot.kv.getPendingMessage('bcast_pending');
  if (!pesan) return;

  const users = (await bot.kv.getUsers()) || [];
  if (users.length === 0) {
    await bot.kv.del('bcast_pending');
    await bot.kv.del('bcast_cursor');
    return;
  }

  let cursor = await bot.kv.getCursor('bcast_cursor');
  if (cursor < 0 || cursor >= users.length) cursor = 0;

  const slice = users.slice(cursor, cursor + BROADCAST_BATCH);
  let ok = 0;
  let fail = 0;
  for (const u of slice) {
    try {
      const r = await bot.send(u.id, `📢 <b>ANNOUNCEMENT</b>\n\n${pesan}`);
      if (r && r.ok) ok++;
      else fail++;
    } catch {
      fail++;
    }
    await sleep(80);
  }

  const next = cursor + BROADCAST_BATCH;
  if (next >= users.length) {
    await bot.kv.del('bcast_pending');
    await bot.kv.del('bcast_cursor');
    if (bot.cfg.ADMIN_ID) {
      await bot.send(bot.cfg.ADMIN_ID, `📢 <b>Broadcast selesai.</b>\n👥 Total user: ${users.length}\n✅ Terkirim: ${ok}\n❌ Gagal: ${fail}`);
    }
  } else {
    await bot.kv.setCursor('bcast_cursor', next);
    if (bot.cfg.ADMIN_ID) {
      await bot.send(bot.cfg.ADMIN_ID, `📢 <b>Broadcast berjalan...</b>\n${next}/${users.length} user terkirim.`);
    }
  }
}