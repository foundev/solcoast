import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPrivateToolDir,
  assertSafeHttpsUrl,
  isPrivateOrReservedIp,
  resolveWithin,
  writeFileAtomicNoSymlink,
} from '../scripts/lib/safe-net.mjs';

describe('Asset Pipeline Security Helpers (safe-net)', () => {
  it('blocks private, loopback, link-local, CGNAT, and IPv4-mapped IPv6 addresses while allowing public IPs', () => {
    const blocked = [
      '127.0.0.1',
      '127.255.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456:789a::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '::ffff:7f00:1',
      'not-an-ip',
    ];
    for (const ip of blocked) {
      expect(isPrivateOrReservedIp(ip), `should block ${ip}`).toBe(true);
    }

    const allowed = ['1.1.1.1', '8.8.8.8', '185.199.108.133', '2606:4700:4700::1111'];
    for (const ip of allowed) {
      expect(isPrivateOrReservedIp(ip), `should allow ${ip}`).toBe(false);
    }
  });

  it('enforces HTTPS, host allowlist, standard port, and rejects embedded credentials or internal hosts', () => {
    const allowed = new Set(['api.polyhaven.com', 'dl.polyhaven.org']);

    expect(assertSafeHttpsUrl('https://api.polyhaven.com/files/sofa_03', allowed)).toBe(
      'https://api.polyhaven.com/files/sofa_03',
    );
    expect(() => assertSafeHttpsUrl('http://api.polyhaven.com/files/sofa_03', allowed)).toThrow();
    expect(() => assertSafeHttpsUrl('file:///etc/passwd', allowed)).toThrow();
    expect(() => assertSafeHttpsUrl('https://user:pass@api.polyhaven.com/files/sofa_03', allowed)).toThrow();
    expect(() => assertSafeHttpsUrl('https://api.polyhaven.com:8443/files/sofa_03', allowed)).toThrow();
    expect(() => assertSafeHttpsUrl('https://evil.example.com/model.glb', allowed)).toThrow();
    expect(() => assertSafeHttpsUrl('https://169.254.169.254/latest/meta-data/')).toThrow();
    expect(() => assertSafeHttpsUrl('https://[::ffff:127.0.0.1]/admin')).toThrow();
    expect(() => assertSafeHttpsUrl('https://metadata.google.internal/computeMetadata/v1/')).toThrow();
  });

  it('prevents path traversal and refuses to overwrite symlinks when writing assets', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'solcoast-sec-test-'));
    try {
      expect(() => resolveWithin(tmpBase, '../escape.txt')).toThrow();
      expect(() => resolveWithin(tmpBase, '/etc/passwd')).toThrow();
      expect(() => resolveWithin(tmpBase, 'foo\0bar.glb')).toThrow();
      expect(resolveWithin(tmpBase, 'textures/wood.jpg')).toBe(path.join(tmpBase, 'textures', 'wood.jpg'));

      const okDest = path.join(tmpBase, 'nested', 'ok.txt');
      writeFileAtomicNoSymlink(tmpBase, okDest, 'safe-content');
      expect(String(fs.readFileSync(okDest, 'utf8'))).toBe('safe-content');

      const victim = path.join(tmpBase, 'victim.txt');
      fs.writeFileSync(victim, 'original');
      const linkPath = path.join(tmpBase, 'link.txt');
      fs.symlinkSync(victim, linkPath);
      expect(() => writeFileAtomicNoSymlink(tmpBase, linkPath, 'overwritten')).toThrow(/symlink/i);
      expect(String(fs.readFileSync(victim, 'utf8'))).toBe('original');
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('rejects world-writable or symlinked private tooling directories', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'solcoast-tool-test-'));
    try {
      const privateDir = path.join(tmpBase, 'private-opt');
      fs.mkdirSync(privateDir, { mode: 0o700 });
      fs.writeFileSync(path.join(privateDir, 'package.json'), '{}');
      fs.chmodSync(path.join(privateDir, 'package.json'), 0o600);
      expect(assertPrivateToolDir(privateDir)).toBe(path.join(privateDir, 'package.json'));

      // World-writable directory must be rejected
      fs.chmodSync(privateDir, 0o777);
      expect(() => assertPrivateToolDir(privateDir)).toThrow(/world-writable/i);
      fs.chmodSync(privateDir, 0o700);

      // Symlinked tooling dir must be rejected
      const symlinkDir = path.join(tmpBase, 'sym-opt');
      fs.symlinkSync(privateDir, symlinkDir);
      expect(() => assertPrivateToolDir(symlinkDir)).toThrow(/symlink/i);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
