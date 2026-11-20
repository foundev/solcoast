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

  varying vec3 vWorldDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = dir.y;

    vec3 col;
    if (h >= 0.0) {
      float t = pow(clamp(h, 0.0, 1.0), 0.52);
      col = mix(uHorizonColor, uZenithColor, t);
    } else {
      col = mix(uHorizonColor, uGroundColor, clamp(-h * 4.0, 0.0, 1.0));
    }

    // Sun glow and crisp solar disk
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float sunHalo = pow(sunDot, 12.0) * 0.55;
    float sunCore = smoothstep(0.9965, 0.9992, sunDot) * 2.2;
    col += uSunColor * (sunHalo + sunCore) * (1.0 - uNightFactor * 0.85);

    // Subtle stars at night
    if (uNightFactor > 0.15 && h > 0.06) {
      vec3 grid = floor(dir * 180.0);
      float starVal = hash(grid);
      if (starVal > 0.9945) {
        float brightness = smoothstep(0.9945, 0.9995, starVal) * uNightFactor * smoothstep(0.06, 0.3, h);
        col += vec3(0.85, 0.92, 1.0) * brightness * 1.4;
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
  };

  private readonly tmpSunDir = new THREE.Vector3();
  private readonly tmpZenith = new THREE.Color();
  private readonly tmpHorizon = new THREE.Color();
  private readonly tmpSunColor = new THREE.Color();
  private readonly tmpGround = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.uniforms = {
      uZenithColor: { value: new THREE.Color(0x284d8f) },
      uHorizonColor: { value: new THREE.Color(0xff8e7a) },
      uGroundColor: { value: new THREE.Color(0x162438) },
      uSunDir: { value: new THREE.Vector3(0.7, 0.25, -0.5).normalize() },
      uSunColor: { value: new THREE.Color(0xffbd75) },
      uNightFactor: { value: 0.15 },
    };

    const skyGeo = new THREE.SphereGeometry(950, 32, 20);
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

    this.sunLight = new THREE.DirectionalLight(0xffe1b8, 2.4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 360;
    const d = 125;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x9bd6ff, 0x3a2d40, 0.85);
    scene.add(this.hemiLight);

    this.fog = new THREE.FogExp2(0xd78f8c, 0.00145);
    scene.fog = this.fog;
  }

  public update(timeOfDayHours: number, focusPos: THREE.Vector3): SkyUpdateResult {
    const h = ((timeOfDayHours % 24) + 24) % 24;
    // Sun elevation angle: 6:00 sunrise -> 12:00 zenith -> 18:00 sunset
    const dayAngle = ((h - 6) / 12) * Math.PI;
    const sunY = Math.sin(dayAngle);
    const sunHoriz = Math.cos(dayAngle);

    // Put golden sunset over the western skyline and sunrise over the Atlantic ocean (+X)
    this.tmpSunDir.set(sunHoriz * 0.92, Math.max(sunY, -0.35), -0.38).normalize();
    const clampedSunLightDir = this.tmpSunDir.clone();
    if (clampedSunLightDir.y < 0.14) {
      // Gentle moonlight from above during night
      clampedSunLightDir.set(-0.4, 0.55, 0.65).normalize();
    }

    // Compute smooth blend weights: day, sunset/dawn, night
    const nightFactor = clamp((0.12 - sunY) / 0.34, 0, 1);
    const sunsetBand = clamp(1 - Math.abs(sunY - 0.14) / 0.32, 0, 1);

    // Palette colors (Miami inspired!)
    const dayZenith = new THREE.Color(0x1f7ae0);
    const dayHorizon = new THREE.Color(0x9be8ff);
    const sunsetZenith = new THREE.Color(0x2c2e78);
    const sunsetHorizon = new THREE.Color(0xff6b8b);
    const nightZenith = new THREE.Color(0x070a1c);
    const nightHorizon = new THREE.Color(0x1a173b);

    this.tmpZenith.copy(dayZenith).lerp(sunsetZenith, sunsetBand).lerp(nightZenith, nightFactor);
    this.tmpHorizon.copy(dayHorizon).lerp(sunsetHorizon, sunsetBand).lerp(nightHorizon, nightFactor);

    const daySun = new THREE.Color(0xfff4dd);
    const sunsetSun = new THREE.Color(0xff9459);
    const moonSun = new THREE.Color(0x7aa4ff);
    this.tmpSunColor.copy(daySun).lerp(sunsetSun, sunsetBand).lerp(moonSun, nightFactor);
    this.tmpGround.setHex(0x182538).lerp(new THREE.Color(0x080b18), nightFactor);

    this.uniforms.uZenithColor.value.copy(this.tmpZenith);
    this.uniforms.uHorizonColor.value.copy(this.tmpHorizon);
    this.uniforms.uGroundColor.value.copy(this.tmpGround);
    this.uniforms.uSunDir.value.copy(this.tmpSunDir);
    this.uniforms.uSunColor.value.copy(this.tmpSunColor);
    this.uniforms.uNightFactor.value = nightFactor;

    this.skyMesh.position.copy(focusPos);

    // Directional light tracks player for crisp local shadows
    this.sunLight.position.copy(focusPos).addScaledVector(clampedSunLightDir, 150);
    this.sunLight.target.position.copy(focusPos);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(this.tmpSunColor);
    this.sunLight.intensity = lerp(2.55, 0.55, nightFactor) - sunsetBand * 0.25;

    this.hemiLight.color.copy(this.tmpHorizon);
    this.hemiLight.groundColor.setHex(0x3a2c44).lerp(new THREE.Color(0x101428), nightFactor);
    this.hemiLight.intensity = lerp(0.95, 0.42, nightFactor);

    this.fog.color.copy(this.tmpHorizon).lerp(this.tmpZenith, 0.22);
    this.fog.density = lerp(0.00125, 0.00185, nightFactor) + sunsetBand * 0.00025;

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
