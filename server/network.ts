import { lookup as lookupDns } from 'node:dns/promises';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import https from 'node:https';

function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    const a = octets[0]!;
    const b = octets[1]!;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  if (isIP(address) === 6) {
    // Restrict outbound IPv6 to ordinary globally routable unicast, excluding
    // documentation, transition and IPv4-mapped address spaces.
    const normalized = address.toLowerCase();
    return /^[23]/.test(normalized) && !normalized.startsWith('2001:db8:') &&
      !normalized.startsWith('2001:0:') && !normalized.startsWith('2002:');
  }
  return false;
}

export function normalizeSiteUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Use an HTTPS website address without credentials or a custom port.');
  }
  if (url.search || url.hash) throw new Error('Website addresses cannot include a query or fragment.');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
      hostname.endsWith('.internal') || (isIP(hostname) && !publicAddress(hostname))) {
    throw new Error('Use a public website address. Local and private addresses are not supported.');
  }
  return url.toString().replace(/\/$/, '');
}

export type OutboundResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
export type OutboundRequest = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<OutboundResponse>;
export class UnsentRequestError extends Error {}

export function normalizeWordpressRequestUrl(value: string, method: string) {
  const url = new URL(value);
  if (url.search && !(method === 'GET' && /\/wp-json\/wp\/v2\/users\/me$/.test(url.pathname) && url.search === '?context=edit')) {
    throw new Error('Only GET account capability checks may include the exact ?context=edit query.');
  }
  const base = new URL(url);
  base.search = '';
  normalizeSiteUrl(base.toString());
  return url;
}

// For direct requests, pin public DNS addresses to prevent DNS rebinding. Managed
// HTTPS proxies resolve destinations themselves; the caller must bind credentials
// to an administrator-configured website URL before using this transport.
// Redirects are never followed, so credentials cannot move hosts.
export const wordpressRequest: OutboundRequest = async (value, init) => {
  const url = normalizeWordpressRequestUrl(value, init.method);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    const requestOptions: https.RequestOptions & { autoSelectFamily: boolean } = {
      method: init.method,
      headers: init.headers,
      autoSelectFamily: false,
      lookup: (host, options, callback) => {
        if (host !== hostname) { lookup(host, options, callback); return; }
        void lookupDns(hostname, { all: true }).then(addresses => {
          if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) {
            callback(new Error('Website DNS must resolve only to public addresses.'), '', 0);
            return;
          }
          const selected = addresses[0]!;
          callback(null, selected.address, selected.family);
        }, error => callback(error, '', 0));
      },
      timeout: 20_000,
    };
    const request = https.request(url, requestOptions, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2_000_000) request.destroy(new Error('Website returned too much data.'));
      });
      response.on('end', () => resolve({ ok: response.statusCode! >= 200 && response.statusCode! < 300, status: response.statusCode!, json: async () => JSON.parse(body) }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Website request timed out.')));
    request.on('error', error => reject(!request.socket?.bytesWritten ? new UnsentRequestError(error.message) : error));
    request.end(init.body);
  });
};

export const googleRequest: OutboundRequest = async (url, init) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
