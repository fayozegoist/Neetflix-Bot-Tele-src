import type { VaultEntry } from './types';
import type {
  NewVaultRow,
  VaultCounts,
  VaultPage,
  VaultResult,
  VaultStats,
  VaultStatus,
  VaultStore,
} from './vaultstore';

/**
 * 9 baris × 10 kolom = 90 parameter. D1 membatasi 100 parameter per query.
 */
const ROWS_PER_STMT = 9;
/** Maksimal statement per `db.batch()` (batch = 1 perjalanan ke database). */
const STMTS_PER_BATCH = 6;
const IDS_PER_DELETE = 50;

const COLS =
  'id, cookie_hash, raw_text, email, region, country, plan, member_since, next_billing, status, reason, attempts, created_at, checked_at';

interface VaultRow {
  id: number;
  cookie_hash: string;
  raw_text: string;
  email: string | null;
  region: string | null;
  country: string | null;
  plan: string | null;
  member_since: string | null;
  next_billing: string | null;
  status: string;
  reason: string | null;
  attempts: number;
  created_at: number;
  checked_at: number | null;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const changed = (r: unknown): number => {
  const n = (r as { meta?: { changes?: number } })?.meta?.changes;
  return Number.isFinite(n) ? Number(n) : 0;
};

function toEntry(r: VaultRow): VaultEntry {
  return {
    id: r.id,
    rawText: r.raw_text,
    email: r.email || 'Tidak diketahui',
    region: r.region || 'Tidak diketahui',
    country: r.country || undefined,
    plan: r.plan || 'Tidak diketahui',
    memberSince: r.member_since || 'Tidak diketahui',
    nextBilling: r.next_billing || 'Tidak diketahui',
    status: r.status as VaultStatus,
    reason: r.reason || undefined,
  };
}

export class D1VaultRepo implements VaultStore {
  constructor(private readonly db: D1Database) {}

  async insertMany(rows: NewVaultRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const now = Date.now();
    let inserted = 0;

    for (const group of chunk(chunk(rows, ROWS_PER_STMT), STMTS_PER_BATCH)) {
      const stmts = group.map((g) => {
        const placeholders = g.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
        const params = g.flatMap((r) => [
          r.cookieHash,
          r.rawText,
          r.email,
          r.region,
          r.country,
          r.plan,
          r.memberSince,
          r.nextBilling,
          r.status || 'pending',
          now,
        ]);
        return this.db
          .prepare(
            `INSERT OR IGNORE INTO vault (cookie_hash, raw_text, email, region, country, plan, member_since, next_billing, status, created_at) VALUES ${placeholders}`
          )
          .bind(...params);
      });
      const results = await this.db.batch(stmts);
      for (const r of results) inserted += changed(r);
    }
    return inserted;
  }

  /**
   * Ambil beberapa akun aktif secara acak.
   *
   * Catatan biaya: `ORDER BY RANDOM()` memaksa SQLite membaca SELURUH baris yang
   * cocok (terukur: ~9000 baris pada 5000 akun) — terlalu mahal untuk dipanggil
   * setiap generate. Jadi dipakai cara "titik awal acak": pilih beberapa id
   * acak, lalu baca beberapa baris mulai dari situ memakai index
   * (status, country, id). Terukur ~10 baris per panggilan.
   *
   * Sebaran tetap enak karena ada beberapa titik awal (bukan satu blok id yang
   * berurutan), lalu hasilnya diacak ulang sebelum dikembalikan.
   */
  async pickRandom(country: string | null, limit: number): Promise<VaultEntry[]> {
    if (limit <= 0) return [];

    // MAX(id) dioptimalkan SQLite lewat index primary key (O(1)).
    const maxRow = await this.db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM vault`).first<{ m: number }>();
    const maxId = Number(maxRow?.m) || 0;
    if (maxId <= 0) return [];

    const scoped = !!country && country !== 'global';
    const cond = scoped ? 'AND country = ?' : '';
    const base: unknown[] = scoped ? [country] : [];

    const probes = Math.min(3, Math.max(1, Math.ceil(limit / 2)));
    const perProbe = Math.max(2, Math.ceil(limit / probes) + 1);
    const found = new Map<number, VaultEntry>();

    for (let i = 0; i < probes && found.size < limit * 2; i++) {
      const start = 1 + Math.floor(Math.random() * maxId);

      const fwd = await this.db
        .prepare(`SELECT ${COLS} FROM vault WHERE status = 'active' ${cond} AND id >= ? ORDER BY id ASC LIMIT ?`)
        .bind(...base, start, perProbe)
        .all<VaultRow>();
      const fwdRows = fwd.results || [];
      for (const r of fwdRows) found.set(Number(r.id), toEntry(r));

      if (fwdRows.length < perProbe) {
        // Titik awal terlalu ke kanan; sambung dari kiri agar tetap dapat kandidat.
        const back = await this.db
          .prepare(`SELECT ${COLS} FROM vault WHERE status = 'active' ${cond} AND id < ? ORDER BY id DESC LIMIT ?`)
          .bind(...base, start, perProbe)
          .all<VaultRow>();
        for (const r of back.results || []) found.set(Number(r.id), toEntry(r));
      }
    }

    const out = [...found.values()];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out.slice(0, limit);
  }

  async listActivePage(offset: number, limit: number): Promise<VaultPage> {
    // Ambil limit+1 baris: cukup untuk tahu apakah masih ada halaman berikutnya,
    // tanpa COUNT(*) yang memindai seluruh tabel.
    const res = await this.db
      .prepare(`SELECT ${COLS} FROM vault WHERE status = 'active' ORDER BY id LIMIT ? OFFSET ?`)
      .bind(limit + 1, offset)
      .all<VaultRow>();
    const rows = res.results || [];
    const hasNext = rows.length > limit;
    return { entries: rows.slice(0, limit).map(toEntry), hasNext };
  }

  async deleteById(id: number): Promise<boolean> {
    const r = await this.db.prepare(`DELETE FROM vault WHERE id = ?`).bind(id).run();
    return changed(r) > 0;
  }

  async deleteByIds(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    let removed = 0;
    for (const group of chunk(ids, IDS_PER_DELETE)) {
      const r = await this.db
        .prepare(`DELETE FROM vault WHERE id IN (${group.map(() => '?').join(',')})`)
        .bind(...group)
        .run();
      removed += changed(r);
    }
    return removed;
  }

  async clear(): Promise<void> {
    await this.db.prepare(`DELETE FROM vault`).run();
  }

  /** Murah: hitungan menyempit pada index (status, id), bukan pindai penuh. */
  async pendingCount(): Promise<number> {
    const r = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM vault WHERE status = 'pending'`)
      .first<{ n: number }>();
    return Number(r?.n) || 0;
  }

  /**
   * Paling murah: berhenti di baris pending pertama. Dipakai cron tiap menit,
   * jadi tidak boleh memindai seluruh antrean (bayangkan 5000 akun menunggu).
   */
  async hasPending(): Promise<boolean> {
    const r = await this.db
      .prepare(`SELECT 1 AS x FROM vault WHERE status = 'pending' LIMIT 1`)
      .first<{ x: number }>();
    return !!r;
  }

  async countAll(): Promise<VaultCounts> {
    const res = await this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM vault GROUP BY status`)
      .all<{ status: string; n: number }>();
    const c: VaultCounts = { active: 0, pending: 0, dead: 0, total: 0 };
    for (const r of res.results || []) {
      const n = Number(r.n) || 0;
      if (r.status === 'active') c.active = n;
      else if (r.status === 'pending') c.pending = n;
      else if (r.status === 'dead') c.dead = n;
      c.total += n;
    }
    return c;
  }

  /**
   * Rekap lengkap. Ini SATU-SATUNYA jalur yang memindai seluruh tabel, jadi
   * pemanggilnya wajib memakai cache (`vaultstats.ts`).
   */
  async statsSnapshot(): Promise<VaultStats> {
    const [counts, byCountry, deadReasons] = await Promise.all([
      this.countAll(),
      this.countByCountry(),
      this.deadByReason(),
    ]);
    return { counts, byCountry, deadReasons };
  }

  private async countByCountry(): Promise<Array<{ country: string; count: number }>> {
    const res = await this.db
      .prepare(
        `SELECT country, COUNT(*) AS n FROM vault WHERE status = 'active' GROUP BY country ORDER BY n DESC, country ASC`
      )
      .all<{ country: string | null; n: number }>();
    return (res.results || []).map((r) => ({ country: r.country || '??', count: Number(r.n) || 0 }));
  }

  /** Rincian alasan pembuangan, untuk halaman /admin. */
  private async deadByReason(): Promise<Array<{ reason: string; count: number }>> {
    const res = await this.db
      .prepare(
        `SELECT COALESCE(reason, 'lainnya') AS reason, COUNT(*) AS n FROM vault WHERE status = 'dead' GROUP BY reason ORDER BY n DESC`
      )
      .all<{ reason: string; n: number }>();
    return (res.results || []).map((r) => ({ reason: r.reason, count: Number(r.n) || 0 }));
  }

  async fetchPending(limit: number): Promise<VaultEntry[]> {
    const res = await this.db
      .prepare(`SELECT ${COLS} FROM vault WHERE status = 'pending' ORDER BY id ASC LIMIT ?`)
      .bind(limit)
      .all<VaultRow>();
    return (res.results || []).map(toEntry);
  }

  async fetchStaleActive(limit: number): Promise<VaultEntry[]> {
    // checked_at NULL (baru) lebih dulu, lalu yang paling lama tidak dicek.
    const res = await this.db
      .prepare(`SELECT ${COLS} FROM vault WHERE status = 'active' ORDER BY checked_at ASC, id ASC LIMIT ?`)
      .bind(limit)
      .all<VaultRow>();
    return (res.results || []).map(toEntry);
  }

  async applyResults(results: VaultResult[]): Promise<void> {
    if (results.length === 0) return;
    const now = Date.now();
    const stmts: D1PreparedStatement[] = [];

    for (const r of results) {
      // Akun mati TIDAK langsung dihapus, melainkan ditandai `dead` supaya
      // masih bisa dilaporkan di /admin, lalu dipangkas oleh pruneDead().
      stmts.push(
        this.db
          .prepare(
            `UPDATE vault SET status = ?, reason = ?, attempts = attempts + 1, checked_at = ? WHERE id = ?`
          )
          .bind(r.status, r.reason ?? null, now, r.id)
      );
    }
    for (const group of chunk(stmts, STMTS_PER_BATCH)) {
      if (group.length > 0) await this.db.batch(group);
    }
  }

  async pruneDead(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    const r = await this.db
      .prepare(
        `DELETE FROM vault WHERE status = 'dead' AND COALESCE(checked_at, created_at) <= ?`
      )
      .bind(cutoff)
      .run();
    return changed(r);
  }
}
