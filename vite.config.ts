import { defineConfig, type Plugin } from 'vite';

const SHARED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

// Production CSS is served as an external stylesheet, so block injected <style> elements
// while still permitting JS progress-bar width updates via style-src-attr.
const PROD_META_CSP = [
  ...SHARED_CSP_DIRECTIVES,
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "connect-src 'self' data: blob:",
].join('; ');

const PROD_HEADER_CSP = `${PROD_META_CSP}; frame-ancestors 'none'`;

// Vite dev injects HMR CSS <style> tags and connects over localhost WebSocket.
const DEV_HEADER_CSP = [
  ...SHARED_CSP_DIRECTIVES,
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' data: blob: ws://localhost:* ws://127.0.0.1:*",
  "frame-ancestors 'none'",
].join('; ');

const COMMON_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function injectProductionCspMeta(): Plugin {
  return {
    name: 'solcoast-production-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const metaTag = `    <meta http-equiv="Content-Security-Policy" content="${PROD_META_CSP}" />`;
      return html.replace(
        '<meta name="referrer" content="no-referrer" />',
        `<meta name="referrer" content="no-referrer" />\n${metaTag}`,
      );
    },
  };
}

export default defineConfig({
  plugins: [injectProductionCspMeta()],
  server: {
    port: 5173,
    open: false,
    fs: {
      strict: true,
    },
    headers: {
      ...COMMON_SECURITY_HEADERS,
      'Content-Security-Policy': DEV_HEADER_CSP,
    },
  },
  preview: {
    headers: {
      ...COMMON_SECURITY_HEADERS,
      'Content-Security-Policy': PROD_HEADER_CSP,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: process.env.BUILD_SOURCEMAP === 'true',
    // vendor-rapier is Rapier3D WASM (@dimforge/rapier3d-compat inlines its
    // ~3 MB WASM as base64 => 4.3 MB JS / 1.6 MB gzip). It is not initial-load
    // code: main.ts only dynamic-imports it on the first ragdoll impact (then
    // idle-prefetches it), so the chunks actually loaded up front stay small
    // (index ~368 kB, vendor-three ~638 kB). 4500 kB accommodates that one
    // known WASM chunk while still warning if any other chunk balloons.
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@dimforge/rapier3d-compat')) return 'vendor-rapier';
          if (id.includes('node_modules/three')) return 'vendor-three';
          return undefined;
        },
      },
    },
  },
});
