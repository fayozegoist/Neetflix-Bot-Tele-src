import type { VaultEntry } from './types';

export type VaultStatus = 'pending' | 'active' | 'dead';

/** Alasan akun dibuang (atau ditandai belum bisa dipastikan). */
export type VaultReason = 'cookie_mati' | 'billing_lewat' | 'tanpa_cookie' | 'ambigu';

export interface NewVaultRow {
  cookieHash: string;
  rawText: string;
  email: string;
  region: string;
  country: string | null;
  plan: string;
  memberSince: string;
  nextBilling: string;
  /** `active` untuk akun yang baru lolos verifikasi convert; default `pending`. */
  status?: VaultStatus;
}

export interface VaultResult {
  id: number;
  status: VaultStatus;
  reason?: VaultReason;
}

export interface VaultCounts {
  active: number;
  pending: number;
  dead: number;
  total: number;
}

export interface VaultPage {
  entries: VaultEntry[];
  /** Masih ada halaman berikutnya (dihitung tanpa memindai seluruh tabel). */
  hasNext: boolean;
}

/** Rekap seluruh isi vault; mahal, jadi dipakai lewat cache. */
export interface VaultStats {
  counts: VaultCounts;
  byCountry: Array<{ country: string; count: number }>;
  deadReasons: Array<{ reason: string; count: number }>;
}

/**
 * Abstraksi penyimpanan Vault.
 *
 * Handler/generate/convert/validate hanya bergantung pada interface ini, bukan
 * pada D1, sehingga bisa diuji dengan implementasi in-memory maupun SQL asli.
 *
 * Catatan penting soal biaya: pada free plan D1, kuota dihitung dari baris yang
 * dibaca (5 juta/hari). Karena itu operasi yang dipakai jalur panas (generate,
 * cron tiap menit) sengaja hanya menyentuh segelintir baris:
 *   - `pickRandom`  : beberapa baris lewat index (status, country)
 *   - `pendingCount`: hitungan sempit pada index status
 *   - `listActivePage`: limit+1 baris, tanpa COUNT(*) seluruh tabel
 * Hanya `statsSnapshot()` yang memindai seluruh tabel, dan itu dipanggil lewat
 * cache KV ber-TTL.
 */
export interface VaultStore {
  /** Sisipkan baris baru; duplikat (cookie sama) dilewati. Hasil = jumlah masuk. */
  insertMany(rows: NewVaultRow[]): Promise<number>;

  /** Ambil `limit` akun aktif acak (opsional difilter negara). */
  pickRandom(country: string | null, limit: number): Promise<VaultEntry[]>;

  /** Halaman akun aktif, urut id. */
  listActivePage(offset: number, limit: number): Promise<VaultPage>;

  deleteById(id: number): Promise<boolean>;
  deleteByIds(ids: number[]): Promise<number>;
  clear(): Promise<void>;

  /** Jumlah akun menunggu validasi (murah: hanya menyentuh rentang status). */
  pendingCount(): Promise<number>;

  /** Ada akun menunggu validasi? (paling murah: berhenti di baris pertama). */
  hasPending(): Promise<boolean>;

  /** Hitungan status lengkap (pindai seluruh tabel — pakai cache). */
  countAll(): Promise<VaultCounts>;

  /** Rekap lengkap untuk halaman /admin (pindai seluruh tabel — pakai cache). */
  statsSnapshot(): Promise<VaultStats>;

  /** Antrian validasi: akun yang belum pernah diperiksa. */
  fetchPending(limit: number): Promise<VaultEntry[]>;

  /** Akun aktif yang paling lama tidak diperiksa (rotasi sweep). */
  fetchStaleActive(limit: number): Promise<VaultEntry[]>;

  /** Tulis hasil validasi sekaligus (satu batch). */
  applyResults(results: VaultResult[]): Promise<void>;

  /** Buang baris `dead` yang lebih tua dari `olderThanMs`. */
  pruneDead(olderThanMs: number): Promise<number>;
}
