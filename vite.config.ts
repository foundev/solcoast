import { defineConfig, type Plugin } from 'vite';

const BASE_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

const PROD_META_CSP = [...BASE_CSP_DIRECTIVES, "connect-src 'self' data: blob:"].join('; ');
const PROD_HEADER_CSP = `${PROD_META_CSP}; frame-ancestors 'none'`;
const DEV_HEADER_CSP = [
  ...BASE_CSP_DIRECTIVES,
  "connect-src 'self' data: blob: ws://localhost:* ws://127.0.0.1:*",
  "frame-ancestors 'none'",
].join('; ');

const COMMON_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
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
    chunkSizeWarningLimit: 800,
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
