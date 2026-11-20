import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * GTA Miami-inspired cinematic post-processing pass:
 * subtle warm highlights / cool coastal shadows split-toning, crisp micro-contrast,
 * gentle vignette, and faint atmospheric glare.
 */
const CINEMATIC_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uNightFactor: { value: 0.15 },
    uSpeedNorm: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uNightFactor;
    uniform float uSpeedNorm;
    varying vec2 vUv;

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // Subtle high-speed radial edge chromatic aberration (like GTA V top-speed camera)
      float ca = uSpeedNorm * 0.0022 * r2;
      float r = texture2D(tDiffuse, vUv + centered * ca).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - centered * ca).b;
      vec3 col = vec3(r, g, b);

      // Subtle S-curve contrast & saturation lift
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, mix(1.14, 1.22, uNightFactor));
      col = col * col * (3.0 - 2.0 * col) * 0.16 + col * 0.84;

      // Golden-hour / teal-shadow Miami split toning
      vec3 warmHigh = mix(vec3(1.04, 1.01, 0.96), vec3(1.03, 0.96, 1.06), uNightFactor);
      vec3 coolLow = mix(vec3(0.95, 0.99, 1.05), vec3(0.92, 0.97, 1.08), uNightFactor);
      col *= mix(coolLow, warmHigh, smoothstep(0.12, 0.78, luma));

      // Gentle cinematic vignette
      float vig = 1.0 - smoothstep(0.28, 0.92, r2 * 1.45) * 0.34;
      col *= vig;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export function createCinematicGradePass(): ShaderPass {
  return new ShaderPass(CINEMATIC_GRADE_SHADER);
}

/**
 * Radial additive lens-glow sprite texture for headlights, streetlamps, traffic lights, and sun glare.
 */
export function createLightGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.18, 'rgba(255, 255, 255, 0.65)');
  grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.18)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
