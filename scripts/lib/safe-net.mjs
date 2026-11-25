import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_REDIRECTS = 5;

function parseIpv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

/**
 * Returns true if an IPv4 or IPv6 literal belongs to a loopback, private,
 * link-local, CGNAT, unspecified, multicast, or reserved range.
 */
export function isPrivateOrReservedIp(rawIp) {
  const ip = String(rawIp).trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const ver = net.isIP(ip);
  if (ver === 4) {
    const o = parseIpv4(ip);
    if (!o) return true;
    const [a, b] = o;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (a === 127) return true; // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local / cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
    if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && o[2] === 2) return true; // TEST-NET-1
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking)
    if (a >= 224) return true; // multicast & reserved
    return false;
  }
  if (ver === 6) {
    if (ip === '::' || ip === '::1') return true;
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (ip.startsWith('::ffff:')) {
      const tail = ip.slice('::ffff:'.length);
      if (net.isIP(tail) === 4) return isPrivateOrReservedIp(tail);
      const hexParts = tail.split(':');
      if (hexParts.length === 2) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        if (Number.isInteger(hi) && Number.isInteger(lo)) {
          const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isPrivateOrReservedIp(v4);
        }
      }
      return true;
    }
    // fc00::/7 (Unique Local), fe80::/10 (Link-Local), ff00::/8 (Multicast), 100::/64 (Discard)
    const firstHextet = parseInt(ip.split(':')[0] || '0', 16);
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8
    if (firstHextet === 0x0100) return true;
    return false;
  }
  return true; // Non-IP passed to IP checker -> fail closed
}

export function assertSafeHttpsUrl(rawUrl, allowedHosts = null) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing non-HTTPS URL: ${rawUrl}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Refusing URL with embedded credentials: ${rawUrl}`);
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error(`Refusing non-standard HTTPS port (${parsed.port}) in URL: ${rawUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(`Refusing local/internal hostname: ${rawUrl}`);
  }
  const bareHost = host.replace(/^\[|\]$/g, '');
  if (net.isIP(bareHost) !== 0 && isPrivateOrReservedIp(bareHost)) {
    throw new Error(`Refusing private/reserved IP URL: ${rawUrl}`);
  }
  if (allowedHosts && !allowedHosts.has(host)) {
    throw new Error(`Refusing untrusted host "${host}" for URL: ${rawUrl}`);
  }
  return parsed.toString();
}

export async function assertHostResolvesPublic(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare) !== 0) {
    if (isPrivateOrReservedIp(bare)) {
      throw new Error(`Refusing private/reserved IP: ${bare}`);
    }
    return;
  }
  const records = await dns.lookup(bare, { all: true, verbatim: true });
  if (!records.length) {
    throw new Error(`DNS lookup returned no addresses for ${bare}`);
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(`Refusing host "${bare}" resolving to private/reserved IP ${rec.address}`);
    }
  }
}

async function readStreamWithLimit(body, maxBytes, urlLabel) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeded limit (${maxBytes} bytes) for ${urlLabel}`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/**
 * Performs an HTTPS fetch with pre-request redirect validation (eliminating
 * redirect-to-internal SSRF), DNS private-IP blocking, request timeout, and
 * streaming byte-limit enforcement.
 */
export async function fetchBufferSafe(
  initialUrl,
  {
    headers = {},
    allowedHosts = null,
    allowRedirectHosts = false,
    maxBytes = 50 * 1024 * 1024,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
  } = {},
) {
  let currentUrl = assertSafeHttpsUrl(initialUrl, allowedHosts);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    await assertHostResolvesPublic(parsed.hostname);

    const res = await fetch(currentUrl, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) {
        throw new Error(`HTTP ${res.status} redirect missing Location header for ${currentUrl}`);
      }
      if (hop === maxRedirects) {
        throw new Error(`Too many redirects (>${maxRedirects}) for ${initialUrl}`);
      }
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = assertSafeHttpsUrl(nextUrl, allowRedirectHosts ? null : allowedHosts);
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`HTTP ${res.status} downloading ${currentUrl}`);
    }

    const contentLen = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLen) && contentLen > maxBytes) {
      await res.body?.cancel();
      throw new Error(`Response too large (${contentLen} bytes) for ${currentUrl}`);
    }

    return readStreamWithLimit(res.body, maxBytes, currentUrl);
  }

  throw new Error(`Redirect loop aborted for ${initialUrl}`);
}

export function resolveWithin(baseDir, relPath) {
  if (
    typeof relPath !== 'string' ||
    relPath.length === 0 ||
    relPath.includes('\0') ||
    path.isAbsolute(relPath)
  ) {
    throw new Error(`Refusing invalid relative path: ${String(relPath)}`);
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, relPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Refusing path traversal outside ${resolvedBase}: ${relPath}`);
  }
  return resolvedTarget;
}

export function assertWithinDir(baseDir, targetPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Refusing path outside ${resolvedBase}: ${targetPath}`);
  }
  return resolvedTarget;
}

/**
 * Atomically writes a file inside baseDir while refusing to overwrite symlinks.
 */
export function writeFileAtomicNoSymlink(baseDir, destPath, data, { dirMode = 0o755, fileMode = 0o644 } = {}) {
  const safeDest = assertWithinDir(baseDir, destPath);
  fs.mkdirSync(path.dirname(safeDest), { recursive: true, mode: dirMode });
  try {
    const st = fs.lstatSync(safeDest);
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlink: ${safeDest}`);
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  const tmpPath = `${safeDest}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, data, { flag: 'wx', mode: fileMode });
    fs.renameSync(tmpPath, safeDest);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  return safeDest;
}

/**
 * Verifies a local tooling directory (e.g. ~/.cache/solcoast/gltf-opt) exists,
 * is not a symlink, is not world-writable, and is owned by the current user.
 */
export function assertPrivateToolDir(dirPath) {
  const resolved = path.resolve(dirPath);
  const pkgPath = path.join(resolved, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      `Missing gltf-transform tooling at ${resolved}. Install privately with:\n` +
        `  mkdir -p -m 700 "${resolved}" && npm install --prefix "${resolved}" @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf meshoptimizer`,
    );
  }
  for (const checkPath of [resolved, pkgPath]) {
    const st = fs.lstatSync(checkPath);
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing symlink in private tooling path: ${checkPath}`);
    }
    if ((st.mode & 0o002) !== 0) {
      throw new Error(`Refusing world-writable tooling path: ${checkPath}`);
    }
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      throw new Error(`Refusing tooling path not owned by current user: ${checkPath}`);
    }
  }
  return pkgPath;
}
