/**
 * Daftar negara & resolver region -> kode ISO2.
 *
 * Region di dalam Vault bisa berupa NAMA ("Spain", "Indonesia") maupun KODE ("AE").
 * resolveCountry() menangani keduanya, plus aksen & nama lokal (ES/PT/EN).
 */

export const COUNTRY_NAMES: Record<string, string> = {
  AE: 'United Arab Emirates', AR: 'Argentina', AT: 'Austria', AU: 'Australia',
  BE: 'Belgium', BG: 'Bulgaria', BR: 'Brazil', CA: 'Canada', CH: 'Switzerland',
  CL: 'Chile', CN: 'China', CO: 'Colombia', CZ: 'Czechia', DE: 'Germany',
  DK: 'Denmark', EE: 'Estonia', EG: 'Egypt', ES: 'Spain', FI: 'Finland',
  FR: 'France', GB: 'United Kingdom', GR: 'Greece', HK: 'Hong Kong', HU: 'Hungary',
  ID: 'Indonesia', IE: 'Ireland', IL: 'Israel', IN: 'India', IS: 'Iceland',
  IT: 'Italy', JP: 'Japan', KR: 'South Korea', LT: 'Lithuania', LU: 'Luxembourg',
  LV: 'Latvia', MD: 'Moldova', MX: 'Mexico', MY: 'Malaysia', NL: 'Netherlands',
  NO: 'Norway', NZ: 'New Zealand', PE: 'Peru', PH: 'Philippines', PL: 'Poland',
  PT: 'Portugal', RO: 'Romania', RS: 'Serbia', RU: 'Russia', SA: 'Saudi Arabia',
  SE: 'Sweden', SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', TH: 'Thailand',
  TR: 'Turkey', TW: 'Taiwan', UA: 'Ukraine', US: 'United States', VN: 'Vietnam',
  ZA: 'South Africa',
};

/**
 * Kode negara, diurutkan A-Z berdasarkan NAMA negara (bukan kode ISO2),
 * supaya daftar di menu enak dibaca. 60 negara -> 3 halaman @20.
 */
export const COUNTRY_CODES: string[] = Object.keys(COUNTRY_NAMES).sort((a, b) =>
  COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b], 'en', { sensitivity: 'base' })
);

const ALIASES: Record<string, string[]> = {
  AE: ['uae'], US: ['usa', 'united states of america', 'america'],
  GB: ['uk', 'great britain', 'england', 'britain'],
  KR: ['korea', 'republic of korea', 'korea republic', 'south korean', '한국'],
  CZ: ['czech republic', 'ceska republika'], NL: ['holland', 'the netherlands', 'nederland'],
  RU: ['russian federation', 'россия'], VN: ['viet nam'], MD: ['republic of moldova'],
  TR: ['turkiye'], BR: ['brasil'], DE: ['deutschland'], MX: ['mexico'],
  JP: ['jepang', 'nippon', '日本'], CN: ['zhongguo', 'china', '中国'],
  ES: ['espana'], IT: ['italia'], PL: ['polska'], PT: ['portugal'], UA: ['ukraina'],
  CL: ['chile'], CO: ['colombia'], PE: ['peru'], TH: ['thailand'], MY: ['malaysia'],
  SG: ['singapura'], PH: ['pilipinas'], RO: ['romania'], HU: ['magyarorszag'],
  GR: ['hellas'], AT: ['osterreich'], BE: ['belgique'], CH: ['schweiz', 'suisse'],
  DK: ['danmark'], NO: ['norge'], FI: ['suomi'], IE: ['eire'], LT: ['lietuva'],
  LV: ['latvija'], EE: ['eesti'], RS: ['srbija'], SK: ['slovensko'], SI: ['slovenija'],
  SE: ['sverige'], IS: ['island'], MK: ['macedonia'], BO: ['bolivia'], VE: ['venezuela'],
  SY: ['syria'], IR: ['iran'], TZ: ['tanzania'], CI: ["cote d'ivoire"], CV: ['cape verde'],
  PS: ['palestine'], CD: ['democratic republic of congo'],
};

/** Normalisasi teks region: lowercase, buang aksen combining mark, emoji & tanda baca. */
export function normalizeRegion(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_INDEX: Array<{ code: string; tokens: string[] }> = [];
for (const code of COUNTRY_CODES) {
  NAME_INDEX.push({ code, tokens: [COUNTRY_NAMES[code].toLowerCase(), ...(ALIASES[code] ?? [])] });
}

const CODE_SET = new Map(COUNTRY_CODES.map((c) => [c.toLowerCase(), c]));

/**
 * Ubah teks region menjadi kode negara ISO2.
 * - Kode 2 huruf dicocokkan STRICT EQUALITY (agar "ID" tidak nyangkut di "Indonesia").
 * - Nama/alias dicocokkan dengan batas kata.
 * - Alias non-Latin (CJK/Cyrillic) memakai pencocokan substring.
 * Return null bila tidak dikenali.
 */
export function resolveCountry(regionText: unknown): string | null {
  const t = normalizeRegion(regionText);
  if (!t) return null;

  const exact = CODE_SET.get(t);
  if (exact) return exact;

  for (const { code, tokens } of NAME_INDEX) {
    for (const rawTok of tokens) {
      const tok = normalizeRegion(rawTok);
      if (!tok) continue;
      if (/[^\x00-\x7F]/.test(tok)) {
        if (t.includes(tok)) return code;
        continue;
      }
      const safe = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${safe}\\b`).test(t)) return code;
    }
  }
  return null;
}

/** Emoji bendera dari kode ISO2 (regional indicator symbols). */
export function flagEmoji(code: string): string {
  const upper = String(code).toUpperCase();
  return String.fromCodePoint(
    ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}
