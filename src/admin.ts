import type { Bot } from './bot';
import type { NewVaultRow } from './vaultstore';
import { cookieHash } from './hash';
import { splitAccounts } from './parse';
import { extractCookieDict, extractMetadata, maskEmail } from './netflix';
import { isBillingExpired } from './dateparse';
import { resolveCountry } from './countries';
import { loadBreaker, resume as resumeBreaker, saveBreaker } from './breaker';
import { readStats, refreshStats } from './vaultstats';
import { validateBatch } from './validate';

/** Batas ukuran total teks yang diterima dalam satu request import. */
/**
 * Batas ukuran satu request import.
 *
 * Terukur (scratch/cpujs.mjs): kerja JS satu request import = ~4,2 ms pada
 * 40 KB, ~7,9 ms pada 80 KB, dan ~18,8 ms pada 200 KB. Free plan hanya memberi
 * 10 ms CPU per invocation, jadi 200 KB akan menghasilkan Error 1102.
 * 60 KB (~6 ms) menyisakan ruang untuk sisa request, dan klien mengirim 30 KB.
 */
const MAX_IMPORT_BYTES = 60_000;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** Auth key dari query `?key=` atau header `x-admin-key`. */
function authKey(request: Request, url: URL): string {
  return url.searchParams.get('key') || request.headers.get('x-admin-key') || '';
}

export async function handleAdmin(request: Request, bot: Bot, url: URL): Promise<Response> {
  const expected = bot.cfg.ADMIN_WEB_KEY;
  if (!expected) {
    return new Response(
      'Halaman /admin belum aktif.\nAktifkan dengan:\n  npx wrangler secret put ADMIN_WEB_KEY',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
  if (authKey(request, url) !== expected) {
    return new Response('Forbidden', { status: 401, headers: { 'Content-Type': 'text/plain' } });
  }

  const path = url.pathname.replace(/\/+$/, '') || '/admin';

  if (path === '/admin') {
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    return new Response(adminHtml(expected), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (path === '/admin/api/stats') return statsResponse(bot, url);
  if (path === '/admin/api/import') return request.method === 'POST' ? importResponse(request, bot) : new Response('Method Not Allowed', { status: 405 });
  if (path === '/admin/api/resume') return request.method === 'POST' ? resumeResponse(bot) : new Response('Method Not Allowed', { status: 405 });
  if (path === '/admin/api/validate') return request.method === 'POST' ? validateNowResponse(bot) : new Response('Method Not Allowed', { status: 405 });
  if (path === '/admin/api/prune') return request.method === 'POST' ? pruneResponse(bot) : new Response('Method Not Allowed', { status: 405 });

  return new Response('Not found', { status: 404 });
}

async function statsResponse(bot: Bot, url: URL): Promise<Response> {
  // Rekap dipindai dari D1 hanya bila cache sudah basi (atau dipaksa).
  // Tanpa ini, halaman yang polling bisa menghabiskan kuota baris-baca D1.
  const fresh = url.searchParams.get('fresh') === '1';
  const [stats, breaker] = await Promise.all([readStats(bot, { fresh }), loadBreaker(bot)]);

  return json({
    counts: stats.counts,
    byCountry: stats.byCountry,
    deadReasons: stats.deadReasons,
    at: stats.at,
    cached: stats.cached,
    breaker: {
      perRun: breaker.perRun,
      hardPaused: !!breaker.hardPaused,
      pausedUntil: breaker.pausedUntil || null,
      okStreak: breaker.okStreak || 0,
      ambiguousStreak: breaker.ambiguousStreak || 0,
    },
    now: Date.now(),
  });
}

interface ImportBody {
  source?: string;
  chunks?: unknown;
}

async function importResponse(request: Request, bot: Bot): Promise<Response> {
  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return json({ error: 'body bukan JSON' }, 400);
  }

  const raw = Array.isArray(body.chunks) ? body.chunks.filter((c): c is string => typeof c === 'string') : [];
  if (raw.length === 0) return json({ error: 'tidak ada teks yang dikirim' }, 400);

  const totalLen = raw.reduce((n, s) => n + s.length, 0);
  if (totalLen > MAX_IMPORT_BYTES) {
    return json({ error: `terlalu besar (${totalLen} byte, maksimal ${MAX_IMPORT_BYTES}). Kecilkan ukuran batch.` }, 413);
  }

  const rows: NewVaultRow[] = [];
  let skippedNoCookie = 0;
  let skippedBilling = 0;

  for (const text of raw) {
    // Jaring pengaman: klien boleh mengirim potongan apa pun, server tetap
    // memecahnya dengan pemecah yang sama seperti convert Telegram.
    for (const chunk of splitAccounts(text)) {
      const dict = extractCookieDict(chunk);
      if (!dict.NetflixId) {
        skippedNoCookie++;
        continue;
      }
      const meta = extractMetadata(chunk);

      // Next Billing sudah lewat tidak perlu diuji ke Netflix.
      if (isBillingExpired(meta.nextBilling)) {
        skippedBilling++;
        continue;
      }

      rows.push({
        cookieHash: await cookieHash(dict.NetflixId),
        rawText: chunk.trim(),
        email: maskEmail(meta.email),
        region: meta.region,
        country: resolveCountry(meta.region) ?? null,
        plan: meta.plan,
        memberSince: meta.memberSince,
        nextBilling: meta.nextBilling,
        status: 'pending',
      });
    }
  }

  const inserted = rows.length > 0 ? await bot.vault.insertMany(rows) : 0;

  return json({
    source: body.source || null,
    bytes: totalLen,
    parsed: rows.length,
    inserted,
    duplicate: rows.length - inserted,
    skippedNoCookie,
    skippedBilling,
  });
}

async function resumeResponse(bot: Bot): Promise<Response> {
  const next = resumeBreaker(await loadBreaker(bot));
  await saveBreaker(bot, next);
  return json({ ok: true, breaker: { perRun: next.perRun, hardPaused: false } });
}

async function validateNowResponse(bot: Bot): Promise<Response> {
  await validateBatch(bot);
  const [stats, breaker] = await Promise.all([refreshStats(bot), loadBreaker(bot)]);
  return json({ ok: true, counts: stats.counts, breaker: { perRun: breaker.perRun, hardPaused: !!breaker.hardPaused } });
}

async function pruneResponse(bot: Bot): Promise<Response> {
  const removed = await bot.vault.pruneDead(0);
  const stats = await refreshStats(bot);
  return json({ ok: true, removed, counts: stats.counts });
}

/**
 * Halaman admin: tarik-lepas banyak file, kirim bertahap, pantau progress.
 *
 * Sengaja tanpa template literal di dalam skrip klien agar `${...}` milik Worker
 * tidak bentrok; kunci admin disuntik lewat placeholder.
 */
function adminHtml(key: string): string {
  return HTML_TEMPLATE.replace('__ADMIN_KEY__', key);
}

const HTML_TEMPLATE = String.raw`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>MEDIAFAIRY — Import Vault</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: #0f1115; color: #e6e8ee; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 26px 0 8px; color: #9aa4b8; text-transform: uppercase; letter-spacing: .06em; }
  .sub { color: #7c869c; font-size: 12px; margin-bottom: 18px; }
  #drop { border: 2px dashed #39415a; border-radius: 12px; padding: 30px 18px; text-align: center;
          color: #9aa4b8; cursor: pointer; transition: .15s; background: #141824; }
  #drop.hot { border-color: #4f8cff; background: #18203a; color: #cfe0ff; }
  .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 14px 0; }
  button, select { background: #1c2233; color: #e6e8ee; border: 1px solid #39415a; border-radius: 8px;
                   padding: 8px 13px; font-size: 13px; cursor: pointer; }
  button:hover:not(:disabled) { background: #242c42; }
  button:disabled { opacity: .45; cursor: default; }
  #barwrap { height: 10px; background: #1c2233; border-radius: 6px; overflow: hidden; margin: 8px 0; }
  #bar { height: 100%; width: 0; background: linear-gradient(90deg,#4f8cff,#7f5cff); transition: width .2s; }
  #log { font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #9aa4b8;
         white-space: pre-wrap; max-height: 210px; overflow: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  td, th { padding: 5px 9px; border-bottom: 1px solid #232a3d; text-align: left; }
  th { color: #7c869c; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .card { background: #141824; border: 1px solid #232a3d; border-radius: 10px; padding: 12px 14px; }
  .big { font-size: 26px; font-weight: 700; }
  .ok { color: #3ddc84; } .warn { color: #ffb020; } .bad { color: #ff5f6d; } .muted { color: #7c869c; }
</style>
</head>
<body>
<h1>MEDIAFAIRY — Import Vault</h1>
<div class="sub">Akun masuk sebagai <b>pending</b> dan baru bisa di-generate setelah lolos validasi otomatis. Cookie mati &amp; Next Billing lewat dibuang otomatis.</div>

<div id="drop">Tarik &amp; lepas file <b>.txt</b> ke sini — atau klik untuk memilih.<br><span class="muted">Bisa banyak file sekaligus.</span></div>
<input id="file" type="file" accept=".txt,text/plain" multiple hidden>

<div class="row">
  <label>Ukuran batch:&nbsp;
    <select id="batchSize">
      <option value="20000">20 KB / request</option>
      <option value="30000" selected>30 KB / request (disarankan)</option>
      <option value="45000">45 KB / request</option>
    </select>
  </label>
  <button id="cancel" disabled>Batal</button>
  <span id="state" class="muted">siap</span>
</div>

<div id="barwrap"><div id="bar"></div></div>
<div id="log"></div>

<h2>Status Vault</h2>
<div class="grid">
  <div class="card"><div class="muted">Siap dipakai</div><div class="big ok" id="c-active">–</div></div>
  <div class="card"><div class="muted">Menunggu validasi</div><div class="big warn" id="c-pending">–</div></div>
  <div class="card"><div class="muted">Dibuang</div><div class="big bad" id="c-dead">–</div></div>
  <div class="card"><div class="muted">Laju validasi</div><div class="big" id="c-rate">–</div>
       <div class="muted" id="c-breaker"></div><div class="muted" id="c-age"></div></div>
</div>

<div class="row">
  <button id="btn-resume">Resume validasi</button>
  <button id="btn-validate">Validasi 1 batch sekarang</button>
  <button id="btn-prune">Bersihkan daftar dibuang</button>
  <button id="btn-refresh">Muat ulang status</button>
</div>

<div class="grid">
  <div class="card"><h2 style="margin-top:0">Per negara (aktif)</h2><table id="t-country"></table></div>
  <div class="card"><h2 style="margin-top:0">Alasan dibuang</h2><table id="t-reason"></table></div>
</div>

<script>
var KEY = '__ADMIN_KEY__';
var cancelled = false;

function api(path, opts) {
  opts = opts || {};
  var headers = Object.assign({ 'x-admin-key': KEY }, opts.headers || {});
  if (opts.body) headers['content-type'] = 'application/json';
  var url = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(KEY);
  return fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body })
    .then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
}

function log(msg) {
  var el = document.getElementById('log');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}
function setBar(pct) { document.getElementById('bar').style.width = Math.max(0, Math.min(100, pct)) + '%'; }
function setState(s) { document.getElementById('state').textContent = s; }

// Pecah teks TEPAT SEBELUM setiap baris "Email:". Itulah batas akun yang
// diakui server (lihat splitAccounts), jadi tidak mungkin ada akun terbelah —
// penting karena satu akun berisi beberapa baris kosong di dalamnya, sehingga
// memotong pada baris kosong justru bisa membelah akun.
function splitChunks(text, maxBytes) {
  var t = String(text).replace(/\r\n/g, '\n');
  // Lookahead = pemotongan tanpa menghilangkan apa pun, jadi menggabungkan
  // kembali seluruh unit pasti menghasilkan teks asli.
  var units = t.split(/(?=(?:^|\s)Email\s*:)/im);
  var out = [], cur = '', i, u;

  for (i = 0; i < units.length; i++) {
    u = units[i];
    if (!u) continue;
    // Jaga keutuhan akun: unit yang kebetulan lebih besar dari batas dikirim
    // apa adanya (satu akun tidak pernah dipotong). Server akan menolak dengan
    // pesan jelas kalau melebihi batas total 200 KB.
    if (u.length > maxBytes) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(u);
      continue;
    }
    if (cur && (cur.length + u.length) > maxBytes) { out.push(cur); cur = ''; }
    cur = cur ? cur + u : u;
  }
  if (cur) out.push(cur);
  return out;
}

async function uploadText(text, source) {
  var maxBytes = parseInt(document.getElementById('batchSize').value, 10);
  var chunks = splitChunks(text, maxBytes);
  var totals = { parsed: 0, inserted: 0, duplicate: 0, skipped: 0 };
  log('— ' + source + ': ' + chunks.length + ' batch');

  for (var i = 0; i < chunks.length; i++) {
    if (cancelled) { log('  dibatalkan oleh pengguna'); return totals; }
    var res = await api('/admin/api/import', {
      method: 'POST',
      body: JSON.stringify({ source: source, chunks: [chunks[i]] })
    });
    totals.parsed += res.parsed || 0;
    totals.inserted += res.inserted || 0;
    totals.duplicate += res.duplicate || 0;
    totals.skipped += (res.skippedNoCookie || 0) + (res.skippedBilling || 0);
    setBar(((i + 1) / chunks.length) * 100);
    setState('batch ' + (i + 1) + '/' + chunks.length);
  }
  log('  masuk: ' + totals.inserted + ' | duplikat: ' + totals.duplicate +
      ' | dilewati (billing/tanpa cookie): ' + totals.skipped);
  return totals;
}

async function handleFiles(files) {
  cancelled = false;
  document.getElementById('cancel').disabled = false;
  document.getElementById('log').textContent = '';
  var grand = { inserted: 0, duplicate: 0, skipped: 0 };
  var t0 = Date.now();

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var text = await f.text();
    var r = await uploadText(text, f.name);
    grand.inserted += r.inserted; grand.duplicate += r.duplicate; grand.skipped += r.skipped;
  }

  log('');
  log('SELESAI dalam ' + ((Date.now() - t0) / 1000).toFixed(1) + ' detik');
  log('  total masuk antrean: ' + grand.inserted);
  log('  duplikat (sudah ada): ' + grand.duplicate);
  log('  dilewati: ' + grand.skipped);
  log('  Validasi berjalan otomatis ±12 akun/menit (naik sampai 25 kalau aman).');
  document.getElementById('cancel').disabled = true;
  setState('selesai');
  refresh(true);
}

var drop = document.getElementById('drop');
var input = document.getElementById('file');
drop.onclick = function () { input.click(); };
input.onchange = function () { if (input.files.length) handleFiles(input.files); input.value = ''; };
['dragenter','dragover'].forEach(function (ev) {
  drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('hot'); });
});
['dragleave','drop'].forEach(function (ev) {
  drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('hot'); });
});
drop.addEventListener('drop', function (e) {
  if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

document.getElementById('cancel').onclick = function () { cancelled = true; setState('membatalkan…'); };

function rows(el, data, headA, headB) {
  var h = '<tr><th>' + headA + '</th><th>' + headB + '</th></tr>';
  if (!data || !data.length) return h + '<tr><td colspan="2" class="muted">tidak ada data</td></tr>';
  for (var i = 0; i < data.length; i++) {
    h += '<tr><td>' + data[i].k + '</td><td>' + data[i].v + '</td></tr>';
  }
  return h;
}

async function refresh(force) {
  try {
    var s = await api('/admin/api/stats' + (force ? '?fresh=1' : ''));
    document.getElementById('c-active').textContent = s.counts.active;
    document.getElementById('c-pending').textContent = s.counts.pending;
    document.getElementById('c-dead').textContent = s.counts.dead;
    document.getElementById('c-rate').textContent = s.breaker.perRun + '/menit';
    document.getElementById('c-age').textContent = 'rekap ' + Math.max(0, Math.round((s.now - s.at) / 1000)) + ' detik lalu' + (s.cached ? ' (cache)' : ' (baru)');
    document.getElementById('c-breaker').textContent = s.breaker.hardPaused
      ? 'DIHENTIKAN SEMENTARA — tekan Resume'
      : (s.breaker.pausedUntil && s.breaker.pausedUntil > s.now
          ? 'dijeda ' + Math.ceil((s.breaker.pausedUntil - s.now) / 60000) + ' menit lagi'
          : 'normal (streak ' + s.breaker.okStreak + '/100 untuk naik)');

    var byCountry = (s.byCountry || []).slice(0, 25).map(function (c) { return { k: c.country, v: c.count }; });
    document.getElementById('t-country').innerHTML = rows(null, byCountry, 'Negara', 'Akun');
    var reasons = (s.deadReasons || []).map(function (c) { return { k: c.reason, v: c.count }; });
    document.getElementById('t-reason').innerHTML = rows(null, reasons, 'Alasan', 'Akun');
  } catch (e) {
    document.getElementById('state').textContent = 'gagal memuat status: ' + e.message;
  }
}

document.getElementById('btn-refresh').onclick = function () { refresh(true); };
document.getElementById('btn-resume').onclick = async function () {
  await api('/admin/api/resume', { method: 'POST' });
  log('validasi dilanjutkan'); refresh(true);
};
document.getElementById('btn-validate').onclick = async function () {
  setState('memvalidasi 1 batch…');
  try {
    var r = await api('/admin/api/validate', { method: 'POST' });
    log('validasi manual: aktif=' + r.counts.active + ' pending=' + r.counts.pending + ' dibuang=' + r.counts.dead);
  } catch (e) { log('validasi gagal: ' + e.message); }
  setState('siap'); refresh();
};
document.getElementById('btn-prune').onclick = async function () {
  var r = await api('/admin/api/prune', { method: 'POST' });
  log('daftar dibuang dipangkas: ' + r.removed + ' baris'); refresh();
};

// Polling singkat hanya MEMBACA rekap dari cache; pengambilan dari D1 dibatasi
// oleh TTL di server, jadi kuota baris-baca D1 tetap aman.
refresh(true);
setInterval(function () { refresh(false); }, 10000);
</script>
</body>
</html>`;
