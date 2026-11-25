declare const __dirname: string;

declare module 'node:fs' {
  export function readFileSync(path: string, encoding?: 'utf8'): Uint8Array & {
    buffer: ArrayBuffer;
    byteOffset: number;
    byteLength: number;
  };
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function symlinkSync(target: string, path: string): void;
  export function chmodSync(path: string, mode: number): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  const fs: {
    readFileSync: typeof readFileSync;
    mkdtempSync: typeof mkdtempSync;
    mkdirSync: typeof mkdirSync;
    writeFileSync: typeof writeFileSync;
    symlinkSync: typeof symlinkSync;
    chmodSync: typeof chmodSync;
    rmSync: typeof rmSync;
  };
  export default fs;
}

declare module 'node:os' {
  export function tmpdir(): string;
  const os: { tmpdir: typeof tmpdir };
  export default os;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  const path: { resolve: typeof resolve; join: typeof join };
  export default path;
}
