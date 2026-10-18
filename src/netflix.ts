import type { NfMetadata, NfTokenData } from './types';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractMetadata(text: string): NfMetadata {
  let email = 'Tidak diketahui';
  let region = 'Tidak diketahui';
  let plan = 'Tidak diketahui';
  let memberSince = 'Tidak diketahui';
  let nextBilling = 'Tidak diketahui';

  text.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (/^(?:#\s*)?Email\s*:/i.test(trimmed)) {
      email = trimmed.replace(/^(?:#\s*)?Email\s*:/i, '').trim();
    } else if (/^(?:#\s*)?(Country|Region)\s*:/i.test(trimmed)) {
      const rawRegion = trimmed.replace(/^(?:#\s*)?(Country|Region)\s*:/i, '').trim();
      region = rawRegion.replace(/[^\x20-\x7E]/g, '').trim() || rawRegion;
    } else if (/^(?:#\s*)?Plan\s*:/i.test(trimmed)) {
      plan = trimmed.replace(/^(?:#\s*)?Plan\s*:/i, '').trim();
    } else if (/^(?:#\s*)?Member Since\s*:/i.test(trimmed)) {
      memberSince = trimmed.replace(/^(?:#\s*)?Member Since\s*:/i, '').trim();
    } else if (/^(?:#\s*)?Next Billing\s*:/i.test(trimmed)) {
      nextBilling = trimmed.replace(/^(?:#\s*)?Next Billing\s*:/i, '').trim();
    }
  });

  return { email, region, plan, memberSince, nextBilling };
}

export function maskEmail(email: string): string {
  if (!email || email.includes('Tidak diketahui')) return email;
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const user = parts[0];
  const domain = parts[1];
  return (user.length <= 3 ? user.substring(0, 1) + '***' : user.substring(0, 3) + '****') + '@' + domain;
}

export interface CookieDict {
  NetflixId?: string;
}

export function extractCookieDict(text: string): CookieDict {
  const cookieDict: CookieDict = {};

  try {
    const data: unknown = JSON.parse(text);
    if (Array.isArray(data)) {
      data.forEach((c: { name?: string; value?: string }) => {
        if (c.name === 'NetflixId') cookieDict[c.name] = safeDecode(c.value || '');
      });
      if (cookieDict.NetflixId) return cookieDict;
    }
  } catch {
  }

  const lines = text.split('\n');
  let netflixIdValue = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().replace(/^Cookie:\s*/i, '');
    if (line.includes('NetflixId')) {
      const parts = line.split(/[\t ]+/);
      const idx = parts.indexOf('NetflixId');
      if (idx !== -1 && idx + 1 < parts.length) {
        netflixIdValue = parts[idx + 1];
      } else {
        const match = line.match(/NetflixId=([^;\s]+)/);
        if (match) netflixIdValue = match[1];
      }
      if (netflixIdValue) {
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          if (nextLine && !nextLine.includes(':') && !nextLine.includes('=') && !nextLine.includes('\t') && !nextLine.includes(' ')) {
            netflixIdValue += nextLine;
            j++;
          } else break;
        }
        break;
      }
    } else {
      const match = line.match(/NetflixId=([^;\s]+)/);
      if (match) {
        netflixIdValue = match[1];
        break;
      }
    }
  }
  if (netflixIdValue) cookieDict.NetflixId = safeDecode(netflixIdValue);
  return cookieDict;
}

const API_URL = 'https://ios.prod.ftl.netflix.com/iosui/user/15.48';

function buildParams(): URLSearchParams {
  return new URLSearchParams({
    appVersion: '15.48.1',
    config: '{"gamesInTrailersEnabled":"false","isTrailersEvidenceEnabled":"false","cdsMyListSortEnabled":"true","kidsBillboardEnabled":"true","addHorizontalBoxArtToVideoSummariesEnabled":"false","skOverlayTestEnabled":"false","homeFeedTestTVMovieListsEnabled":"false","baselineOnIpadEnabled":"true","trailersVideoIdLoggingFixEnabled":"true","postPlayPreviewsEnabled":"false","bypassContextualAssetsEnabled":"false","roarEnabled":"false","useSeason1AltLabelEnabled":"false","disableCDSSearchPaginationSectionKinds":["searchVideoCarousel"],"cdsSearchHorizontalPaginationEnabled":"true","searchPreQueryGamesEnabled":"true","kidsMyListEnabled":"true","billboardEnabled":"true","useCDSGalleryEnabled":"true","contentWarningEnabled":"true","videosInPopularGamesEnabled":"true","avifFormatEnabled":"false","sharksEnabled":"true"}',
    device_type: 'NFAPPL-02-',
    esn: 'NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200',
    idiom: 'phone',
    iosVersion: '15.8.5',
    isTablet: 'false',
    languages: 'en-US',
    locale: 'en-US',
    maxDeviceWidth: '375',
    model: 'saget',
    modelType: 'IPHONE8-1',
    odpAware: 'true',
    path: '["account","token","default"]',
    pathFormat: 'graph',
    pixelDensity: '2.0',
    progressive: 'false',
    responseFormat: 'json',
  });
}

function buildHeaders(netflixId: string): Record<string, string> {
  return {
    'User-Agent': 'Argo/15.48.1 (iPhone; iOS 15.8.5; Scale/2.00)',
    'x-netflix.request.attempt': '1',
    'x-netflix.request.client.user.guid': 'A4CS633D7VCBPE2GPK2HL4EKOE',
    'x-netflix.context.profile-guid': 'A4CS633D7VCBPE2GPK2HL4EKOE',
    'x-netflix.request.routing': '{"path":"/nq/mobile/nqios/~15.48.0/user","control_tag":"iosui_argo"}',
    'x-netflix.context.app-version': '15.48.1',
    'x-netflix.client.appversion': '15.48.1',
    'x-netflix.client.type': 'argo',
    'x-netflix.client.ftl.esn': 'NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200',
    'x-netflix.context.os-version': '15.8.5',
    Cookie: `NetflixId=${netflixId}`,
  };
}

export async function fetchNfToken(netflixId: string): Promise<NfTokenData> {
  const response = await fetch(`${API_URL}?${buildParams().toString()}`, {
    headers: buildHeaders(netflixId),
  });
  if (!response.ok) throw new Error(`Koneksi ditolak (Status: ${response.status})`);

  const data: unknown = await response.json().catch(() => {
    throw new Error('Respon Netflix bukan JSON valid.');
  });

  const tokenData = (data as { value?: { account?: { token?: { default?: { token?: string; expires?: unknown } } } } })
    ?.value?.account?.token?.default;

  if (!tokenData || !tokenData.token) {
    throw new Error('Struktur JSON ditolak. Node account/token/default tidak ditemukan.');
  }

  let expires = tokenData.expires as number | string;
  if (typeof expires === 'string') {
    const n = Number(expires);
    expires = Number.isNaN(n) ? Date.now() + 3600000 : n;
  }
  if (String(expires).length !== 13) expires = Number(expires) * 1000;
  if (!Number.isFinite(expires)) expires = Date.now() + 3600000;

  return { token: tokenData.token, expires };
}