export function isPrivateOrReservedIp(rawIp: string): boolean;
export function assertSafeHttpsUrl(rawUrl: string, allowedHosts?: Set<string> | null): string;
export function assertHostResolvesPublic(hostname: string): Promise<void>;
export function fetchBufferSafe(
  initialUrl: string,
  options?: {
    headers?: Record<string, string>;
    allowedHosts?: Set<string> | null;
    allowRedirectHosts?: boolean;
    maxBytes?: number;
    timeoutMs?: number;
    maxRedirects?: number;
  },
): Promise<Uint8Array>;
export function resolveWithin(baseDir: string, relPath: string): string;
export function assertWithinDir(baseDir: string, targetPath: string): string;
export function writeFileAtomicNoSymlink(
  baseDir: string,
  destPath: string,
  data: string | Uint8Array,
  options?: { dirMode?: number; fileMode?: number },
): string;
export function assertPrivateToolDir(dirPath: string): string;
