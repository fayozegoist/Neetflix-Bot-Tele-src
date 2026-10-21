/**
 * Parser tanggal "Next Billing" multi-bahasa (ES / PT / EN).
 *
 * Penting: Date.parse() TIDAK bisa dipakai untuk nama bulan berbahasa asing,
 * dan untuk format "bulan saja" dia(parse) diam-diam ke bulan sebelumnya.
 * Contoh: "septiembre de 2018" -> Date.parse = 31 Agustus (SALAH).
 */

const MONTHS: Record<string, string> = {
  // EN
  january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
  april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
  august: '08', aug: '08', september: '09', sep: '09', sept: '09', october: '10',
  oct: '10', november: '11', nov: '11', december: '12', dec: '12',
  // ES
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
  // PT (abril & agosto sama persis dengan ES, jadi cukup sekali di atas)
  janeiro: '01', fevereiro: '02', marco: '03', maio: '05', junho: '06',
  julho: '07', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

const NUM_MONTH: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse tanggal menjadi epoch ms (UTC). Return null bila tidak bisa diparse.
 * Didukung: "19 de noviembre de 2026", "19 de novembro de 2026",
 * "novembro de 2026", "Nov 19, 2026", "2026-11-19", "19/11/2026".
 */
export function parseBillingDate(raw: unknown): number | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s || s.includes('tidak diketahui')) return null;

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return build(+m[1], +m[2], +m[3]);

  // DD/MM/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return build(+m[3], +m[2], +m[1]);

  // "19 de noviembre de 2026" / "19 de noviembre 2026"
  m = s.match(/^(\d{1,2})\s*(?:de\s+|de\s+la\s+|de\s+el\s+)?([a-zçãéíóú]+)\s*(?:de\s+|,\s*)?(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2]];
    if (mo) return build(+m[3], +mo, +m[1]);
  }

  // "novembro de 2026" (bulan saja, tanpa tanggal)
  m = s.match(/^([a-zçãéíóú]+)\s*(?:de\s+|,\s*)?(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1]];
    if (mo) return build(+m[2], +mo, 1);
  }

  // "Nov 19, 2026"
  m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = NUM_MONTH[m[1].slice(0, 3)];
    if (mo) return build(+m[3], mo, +m[2]);
  }

  // "19 Nov 2026"
  m = s.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const mo = NUM_MONTH[m[2].slice(0, 3)];
    if (mo) return build(+m[3], mo, +m[1]);
  }

  return null;
}

function build(year: number, month: number, day: number): number | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ts = Date.UTC(year, month - 1, day);
  const dt = new Date(ts);
  // round-trip check: tolak 31 Februari dkk
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return ts;
}

/**
 * True kalau tanggal billing sudah lewat.
 * Bila tanggal tidak bisa diparse -> false (konservatif: jangan buang akun).
 */
export function isBillingExpired(raw: unknown, nowMs: number = Date.now()): boolean {
  const ts = parseBillingDate(raw);
  if (ts === null) return false;
  return ts < nowMs;
}
