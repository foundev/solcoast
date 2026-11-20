declare const __dirname: string;

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array & {
    buffer: ArrayBuffer;
    byteOffset: number;
    byteLength: number;
  };
  const fs: { readFileSync: typeof readFileSync };
  export default fs;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  const path: { resolve: typeof resolve };
  export default path;
}
