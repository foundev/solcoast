import * as THREE from 'three';
import { clamp, lerp } from '../core/math';

export interface TimePreset {
  hour: number;
  label: string;
}

export const TIME_PRESETS: TimePreset[] = [
  { hour: 17.5, label: 'GOLDEN HOUR' },
  { hour: 21.5, label: 'NEON NIGHT' },
  { hour: 6.4, label: 'MIAMI DAWN' },
  { hour: 13.0, label: 'SUNNY MIDDAY' },
];

export interface SkyUpdateResult {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  nightFactor: number; // 0 = day, 1 = night
  timeLabel: string;
}

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uGroundColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNightFactor;
  uniform float uSunsetFactor;
  uniform float uTime;

  varying vec3 vWorldDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * noise2(p);
      p = p * 2.03 + vec2(17.1, 31.7);
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = dir.y;
    vec3 sunDir = normalize(uSunDir);

    vec3 col;
    if (h >= 0.0) {
      // Rayleigh-like zenith transition + warm Mie forward horizon scattering
      float t = pow(clamp(h, 0.0, 1.0), 0.48);
      col = mix(uHorizonColor, uZenithColor, t);

      float mieDot = max(dot(dir, sunDir), 0.0);
      float mieGlow = pow(mieDot, 4.0) * (1.0 - smoothstep(0.0, 0.55, h)) * (0.45 + uSunsetFactor * 0.55);
      col += uSunColor * mieGlow * (1.0 - uNightFactor * 0.85);
    } else {
      col = mix(uHorizonColor, uGroundColor, clamp(-h * 4.5, 0.0, 1.0));
    }

    // Crisp sun disc & atmospheric corona
    float sunDot = max(dot(dir, sunDir), 0.0);
    float sunHalo = pow(sunDot, 20.0) * 0.5;
    float sunCore = smoothstep(0.9972, 0.9994, sunDot) * 2.6;
    col += uSunColor * (sunHalo + sunCore) * (1.0 - uNightFactor * 0.9);

    // Layered tropical Miami cumulus & wispy cirrus clouds
    if (h > 0.025) {
      vec2 uv = dir.xz / (h + 0.16) * 0.95;
      vec2 wind = vec2(uTime * 0.0085, uTime * 0.0032);
      float c1 = fbm(uv * 1.15 + wind);
      float c2 = fbm(uv * 2.4 - wind * 0.6 + vec2(4.3, 1.9));
      float cloudDensity = smoothstep(0.47, 0.78, c1 * 0.72 + c2 * 0.38);
      float horizonFade = smoothstep(0.025, 0.22, h) * (1.0 - smoothstep(0.72, 0.98, h) * 0.35);

      // Sunlit silver-gold cloud rims vs cool atmospheric cloud undersides
      vec3 cloudLit = mix(vec3(0.98, 0.99, 1.0), uSunColor * 1.15, 0.45 + uSunsetFactor * 0.5);
      vec3 cloudShadow = mix(uHorizonColor * 0.68, uZenithColor * 0.72, 0.5);
      float lightBias = clamp(c1 * 0.6 + pow(sunDot, 3.0) * 0.55, 0.0, 1.0);
      vec3 cloudCol = mix(cloudShadow, cloudLit, lightBias);
      cloudCol = mix(cloudCol, vec3(0.11, 0.13, 0.24), uNightFactor * 0.86);

      col = mix(col, cloudCol, cloudDensity * horizonFade * 0.78);
    }

    // Crisp twinkling stars at night
    if (uNightFactor > 0.15 && h > 0.08) {
      vec3 grid = floor(dir * 210.0);
      float starVal = hash(grid);
      if (starVal > 0.995) {
        float brightness = smoothstep(0.995, 0.9996, starVal) * uNightFactor * smoothstep(0.08, 0.32, h);
        col += vec3(0.86, 0.93, 1.0) * brightness * 1.3;
      }
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class SkySystem {
  public readonly skyMesh: THREE.Mesh;
  public readonly sunLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly fog: THREE.FogExp2;

  private readonly uniforms: {
    uZenithColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uGroundColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uNightFactor: { value: number };
    uSunsetFactor: { value: number };
    uTime: { value: number };
  };

  // Offscreen PMREM environment scene for crisp IBL reflections on cars & glass towers!
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene: THREE.Scene;
  private readonly envSkyMat: THREE.ShaderMaterial;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private lastEnvHour = -999;

  private readonly tmpSunDir = new THREE.Vector3();
  private readonly tmpZenith = new THREE.Color();
  private readonly tmpHorizon = new THREE.Color();
  private readonly tmpSunColor = new THREE.Color();
  private readonly tmpGround = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    this.uniforms = {
      uZenithColor: { value: new THREE.Color(0x284d8f) },
      uHorizonColor: { value: new THREE.Color(0xff8e7a) },
      uGroundColor: { value: new THREE.Color(0x162438) },
      uSunDir: { value: new THREE.Vector3(0.7, 0.25, -0.5).normalize() },
      uSunColor: { value: new THREE.Color(0xffbd75) },
      uNightFactor: { value: 0.15 },
      uSunsetFactor: { value: 0.7 },
      uTime: { value: 0 },
    };

    const skyGeo = new THREE.SphereGeometry(980, 40, 24);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.frustumCulled = false;
    scene.add(this.skyMesh);

    // Offscreen sky dome for PMREM PBR environment reflections
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    this.envSkyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), this.envSkyMat);
    this.envScene.add(envDome);

    this.sunLight = new THREE.DirectionalLight(0xffe1b8, 2.7);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(4096, 4096);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 320;
    const d = 110;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.025;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x9bd6ff, 0x3a2d40, 0.72);
    scene.add(this.hemiLight);

    this.fog = new THREE.FogExp2(0xd78f8c, 0.00125);
    scene.fog = this.fog;
  }

  public update(timeOfDayHours: number, elapsedSec: number, focusPos: THREE.Vector3): SkyUpdateResult {
    const h = ((timeOfDayHours % 24) + 24) % 24;
    const dayAngle = ((h - 6) / 12) * Math.PI;
    const sunY = Math.sin(dayAngle);
    const sunHoriz = Math.cos(dayAngle);

    this.tmpSunDir.set(sunHoriz * 0.92, Math.max(sunY, -0.35), -0.38).normalize();
    const clampedSunLightDir = this.tmpSunDir.clone();
    if (clampedSunLightDir.y < 0.16) {
      clampedSunLightDir.set(-0.4, 0.55, 0.65).normalize();
    }

    const nightFactor = clamp((0.12 - sunY) / 0.34, 0, 1);
    const sunsetBand = clamp(1 - Math.abs(sunY - 0.14) / 0.32, 0, 1);

    const dayZenith = new THREE.Color(0x1b6ed6);
    const dayHorizon = new THREE.Color(0x9de6ff);
    const sunsetZenith = new THREE.Color(0x232d6b);
    const sunsetHorizon = new THREE.Color(0xfc7d7b);
    const nightZenith = new THREE.Color(0x050816);
    const nightHorizon = new THREE.Color(0x151833);

    this.tmpZenith.copy(dayZenith).lerp(sunsetZenith, sunsetBand).lerp(nightZenith, nightFactor);
    this.tmpHorizon.copy(dayHorizon).lerp(sunsetHorizon, sunsetBand).lerp(nightHorizon, nightFactor);

    const daySun = new THREE.Color(0xfff5e2);
    const sunsetSun = new THREE.Color(0xff9a52);
    const moonSun = new THREE.Color(0x88b0ff);
    this.tmpSunColor.copy(daySun).lerp(sunsetSun, sunsetBand).lerp(moonSun, nightFactor);
    this.tmpGround.setHex(0x1a2838).lerp(new THREE.Color(0x070a14), nightFactor);

    this.uniforms.uZenithColor.value.copy(this.tmpZenith);
    this.uniforms.uHorizonColor.value.copy(this.tmpHorizon);
    this.uniforms.uGroundColor.value.copy(this.tmpGround);
    this.uniforms.uSunDir.value.copy(this.tmpSunDir);
    this.uniforms.uSunColor.value.copy(this.tmpSunColor);
    this.uniforms.uNightFactor.value = nightFactor;
    this.uniforms.uSunsetFactor.value = sunsetBand;
    this.uniforms.uTime.value = elapsedSec;

    this.skyMesh.position.copy(focusPos);

    // Refresh PMREM environment reflection cubemap whenever time-of-day changes appreciably
    const hourDiff = Math.abs(h - this.lastEnvHour);
    if (hourDiff > 0.18 || this.envRenderTarget === null) {
      this.lastEnvHour = h;
      const nextRT = this.pmrem.fromScene(this.envScene, 0.035);
      this.scene.environment = nextRT.texture;
      this.scene.environmentIntensity = lerp(1.15, 0.42, nightFactor);
      this.envRenderTarget?.dispose();
      this.envRenderTarget = nextRT;
    }

    this.sunLight.position.copy(focusPos).addScaledVector(clampedSunLightDir, 145);
    this.sunLight.target.position.copy(focusPos);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(this.tmpSunColor);
    this.sunLight.intensity = lerp(2.85, 0.55, nightFactor) - sunsetBand * 0.2;

    this.hemiLight.color.copy(this.tmpHorizon);
    this.hemiLight.groundColor.setHex(0x3a2d40).lerp(new THREE.Color(0x101424), nightFactor);
    this.hemiLight.intensity = lerp(0.75, 0.34, nightFactor);

    this.fog.color.copy(this.tmpHorizon).lerp(this.tmpZenith, 0.25);
    this.fog.density = lerp(0.00105, 0.00155, nightFactor) + sunsetBand * 0.0002;

    return {
      sunDirection: this.tmpSunDir.clone(),
      sunColor: this.tmpSunColor.clone(),
      fogColor: this.fog.color.clone(),
      nightFactor,
      timeLabel: formatTimeLabel(h),
    };
  }
}

export function formatTimeLabel(hours: number): string {
  const hNorm = ((hours % 24) + 24) % 24;
  const hh = Math.floor(hNorm);
  const mm = Math.floor((hNorm - hh) * 60);
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  let period = 'SUNNY';
  if (hNorm >= 5.5 && hNorm < 8) period = 'DAWN';
  else if (hNorm >= 8 && hNorm < 16) period = 'MIDDAY';
  else if (hNorm >= 16 && hNorm < 19.3) period = 'GOLDEN HOUR';
  else period = 'NEON NIGHT';
  return `${clock} ${period}`;
}
