import type { EngineSoundProfile } from '../entities/vehicle';
import { clamp, rightFromYaw } from './math';

export type FootstepSurface = 'concrete' | 'sand' | 'wood' | 'tile' | 'carpet';

export interface SpatialAudioSample {
  gain: number;
  pan: number;
  dist: number;
}

/**
 * Computes stereo pan (-0.88..+0.88) and smooth inverse-square distance attenuation (0..1)
 * relative to a listener's world XZ position and compass yaw (0 = North/-Z, +PI/2 = East/+X).
 */
export function computeSpatialPanGain(
  listenerX: number,
  listenerZ: number,
  listenerYaw: number,
  srcX: number,
  srcZ: number,
  maxDist: number,
): SpatialAudioSample {
  const dx = srcX - listenerX;
  const dz = srcZ - listenerZ;
  const dist = Math.hypot(dx, dz);
  if (dist >= maxDist || maxDist <= 0) {
    return { gain: 0, pan: 0, dist };
  }
  const t = 1 - dist / maxDist;
  const gain = t * t;
  if (dist < 0.25) {
    return { gain, pan: 0, dist };
  }
  const r = rightFromYaw(listenerYaw);
  const pan = clamp((dx * r.x + dz * r.z) / dist, -0.88, 0.88);
  return { gain, pan, dist };
}

/** Classifies outdoor ground material for realistic surface-specific footstep audio. */
export function detectOutdoorFootstepSurface(x: number, z: number): FootstepSurface {
  // South Pier timber deck
  if (x >= 152 && x <= 286 && Math.abs(z - 160) <= 7.2) {
    return 'wood';
  }
  // Boardwalk promenade planks
  if (x >= 152 && x <= 165.5 && z >= -188 && z <= 188) {
    return 'wood';
  }
  // Marina Cove wooden yacht docks
  if (z >= 187 && z <= 242 && x >= -100 && x <= 70) {
    return 'wood';
  }
  // Sol Beach sandy dunes & wet foreshore
  if (x > 165.5 && x <= 232 && z >= -186 && z <= 192) {
    return 'sand';
  }
  return 'concrete';
}

/** Classifies interior floor PBR material for realistic indoor footsteps. */
export function detectInteriorFootstepSurface(floorPbr: string): FootstepSurface {
  if (floorPbr === 'carpet') return 'carpet';
  if (floorPbr === 'wood') return 'wood';
  if (floorPbr === 'marble' || floorPbr === 'tile' || floorPbr === 'terrazzo') return 'tile';
  return 'concrete';
}

export interface WorldAmbienceParams {
  elapsed: number;
  inCar: boolean;
  inInteriorId: string | null;
  oceanProximity: number; // 0 (inland) .. 1 (on the beach/pier/marina)
  clubProximity: number; // 0 (far) .. 1 (inside Club Neon)
  nearestTraffic: {
    gain: number;
    pan: number;
    speedMps: number;
  } | null;
}

/**
 * Grounded procedural Web Audio engine for Sol Coast:
 * - Vehicle engine, tire drift hiss, dual-tone horn & car door latches
 * - Surface-aware player footsteps (concrete, sand, wood, marble tile, carpet), jump/land thuds
 * - Spatialized (stereo-panned + distance-attenuated) nearby pedestrian footsteps & passing traffic hum
 * - Subtle coastal ocean surf swells, interior door latches, brass elevator bell & Club Neon sub-bass
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;

  // Player vehicle realistic acoustic engine synth (custom PeriodicWave + muffler formants + exhaust air + road roll)
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineWaveMap: Partial<Record<EngineSoundProfile, PeriodicWave>> = {};
  private engineOscAGain: GainNode | null = null;
  private engineOscBGain: GainNode | null = null;
  private engineSubGain: GainNode | null = null;
  private engineResonator: BiquadFilterNode | null = null;
  private engineMuffler1: BiquadFilterNode | null = null;
  private engineMuffler2: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private exhaustNoiseFilter: BiquadFilterNode | null = null;
  private exhaustNoiseGain: GainNode | null = null;
  private roadRollFilter: BiquadFilterNode | null = null;
  private roadRollGain: GainNode | null = null;
  private turboAirFilter: BiquadFilterNode | null = null;
  private turboAirGain: GainNode | null = null;
  private activeEngineProfile: EngineSoundProfile | null = null;
  private driftGain: GainNode | null = null;
  private hornOscA: OscillatorNode | null = null;
  private hornOscB: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;

  // Spatialized nearby passing traffic car continuous nodes
  private trafficOsc: OscillatorNode | null = null;
  private trafficFilter: BiquadFilterNode | null = null;
  private trafficPanner: StereoPannerNode | null = null;
  private trafficGain: GainNode | null = null;

  // Coastal ocean surf & Club Neon subtle low-end ambience
  private oceanGain: GainNode | null = null;
  private oceanFilter: BiquadFilterNode | null = null;
  private clubOsc: OscillatorNode | null = null;
  private clubGain: GainNode | null = null;

  private lastImpactTime = 0;
  private lastPlayerStepTime = 0;
  private lastNpcStepTime = 0;
  public enabled = true;

  public unlock(): void {
    if (this.ctx || typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    // Shared 2-second white noise buffer (crisp transients) + warm pink noise buffer (exhaust, road roll, surf!)
    const bufLen = Math.floor(ctx.sampleRate * 2.0);
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    const warmBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const wData = warmBuf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufLen; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = white;
      // Smooth 1/f pink noise filter — warm, velvety acoustic air with zero harsh digital hiss!
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      wData[i] = clamp((b0 + b1 + b2 + white * 0.1848) * 0.22, -1, 1);
    }
    this.noiseBuf = noiseBuf;

    // Helper: craft warm band-limited PeriodicWave spectra per engine architecture (ZERO harsh sawtooth buzz!)
    const makeEngineWave = (harmonics: number[]): PeriodicWave => {
      const real = new Float32Array(harmonics.length + 1);
      const imag = new Float32Array(harmonics.length + 1);
      for (let i = 0; i < harmonics.length; i++) {
        imag[i + 1] = harmonics[i];
      }
      return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    };
    this.engineWaveMap = {
      // Smooth singing V12 (warm fundamental + rich 2nd/3rd/4th/6th, zero jagged high buzz)
      'exotic-v12': makeEngineWave([1.0, 0.72, 0.52, 0.32, 0.16, 0.14, 0.06, 0.03]),
      // Deep throaty cross-plane V8 (strong low body + uneven 2nd/3rd growl, rolled off cleanly)
      'muscle-v8': makeEngineWave([1.0, 0.85, 0.42, 0.28, 0.12, 0.07, 0.03]),
      // Distinctive raspy flat-6 boxer harmonic balance
      flat6: makeEngineWave([0.92, 0.78, 0.56, 0.24, 0.18, 0.08, 0.03]),
      // Zippy tuned inline-6/4 turbo
      'turbo-jdm': makeEngineWave([0.95, 0.82, 0.46, 0.26, 0.14, 0.06]),
      // Silky grand-touring V6
      'sport-v6': makeEngineWave([1.0, 0.64, 0.44, 0.18, 0.08, 0.03]),
      // Ultra-clean smooth EV sine/2nd harmonic
      'electric-ev': makeEngineWave([1.0, 0.16, 0.04]),
      // Quiet warm commuter 4-cylinder
      'commuter-i4': makeEngineWave([1.0, 0.58, 0.26, 0.1, 0.04]),
      // Heavy deep SUV V8
      'heavy-v8': makeEngineWave([1.0, 0.78, 0.34, 0.18, 0.06, 0.02]),
    };

    // Soft warm exhaust-manifold waveshaper curve (gentle analog warmth, no harsh clipping)
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = Math.tanh(x * 1.45);
    }
    shaper.curve = curve;

    // 1. Acoustic Engine Synth: dual detuned cylinder-bank PeriodicWave oscillators + warm sine sub
    //    -> soft exhaust saturation -> exhaust-box resonant formant -> steep 24dB/oct dual muffler lowpass!
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    oscA.setPeriodicWave(this.engineWaveMap['exotic-v12']!);
    oscB.setPeriodicWave(this.engineWaveMap['exotic-v12']!);
    subOsc.type = 'sine';
    oscA.frequency.value = 60;
    oscB.frequency.value = 60.6;
    subOsc.frequency.value = 30;

    const oscAGain = ctx.createGain();
    oscAGain.gain.value = 0.55;
    const oscBGain = ctx.createGain();
    oscBGain.gain.value = 0.45;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.45;

    const resonator = ctx.createBiquadFilter();
    resonator.type = 'peaking';
    resonator.frequency.value = 185;
    resonator.Q.value = 1.6;
    resonator.gain.value = 5.0;

    const muffler1 = ctx.createBiquadFilter();
    muffler1.type = 'lowpass';
    muffler1.frequency.value = 380;
    muffler1.Q.value = 0.75;

    const muffler2 = ctx.createBiquadFilter();
    muffler2.type = 'lowpass';
    muffler2.frequency.value = 620;
    muffler2.Q.value = 0.6;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;

    oscA.connect(oscAGain);
    oscB.connect(oscBGain);
    subOsc.connect(subGain);
    oscAGain.connect(shaper);
    oscBGain.connect(shaper);
    subGain.connect(shaper);
    shaper.connect(resonator);
    resonator.connect(muffler1);
    muffler1.connect(muffler2);
    muffler2.connect(engineGain);
    engineGain.connect(ctx.destination);
    oscA.start();
    oscB.start();
    subOsc.start();

    // 1b. Throaty Exhaust & Intake Air Chuff (warm pink noise — mechanical breathiness, zero static hiss!)
    const exhaustNoiseSrc = ctx.createBufferSource();
    exhaustNoiseSrc.buffer = warmBuf;
    exhaustNoiseSrc.loop = true;
    const exhaustNoiseFilter = ctx.createBiquadFilter();
    exhaustNoiseFilter.type = 'bandpass';
    exhaustNoiseFilter.frequency.value = 260;
    exhaustNoiseFilter.Q.value = 1.2;
    const exhaustNoiseGain = ctx.createGain();
    exhaustNoiseGain.gain.value = 0;
    exhaustNoiseSrc.connect(exhaustNoiseFilter);
    exhaustNoiseFilter.connect(exhaustNoiseGain);
    exhaustNoiseGain.connect(ctx.destination);
    exhaustNoiseSrc.start();

    // 1c. Warm Tire-on-Asphalt Road & Wind Rush (scales naturally with vehicle speed)
    const roadRollSrc = ctx.createBufferSource();
    roadRollSrc.buffer = warmBuf;
    roadRollSrc.loop = true;
    const roadRollFilter = ctx.createBiquadFilter();
    roadRollFilter.type = 'lowpass';
    roadRollFilter.frequency.value = 280;
    roadRollFilter.Q.value = 0.6;
    const roadRollGain = ctx.createGain();
    roadRollGain.gain.value = 0;
    roadRollSrc.connect(roadRollFilter);
    roadRollFilter.connect(roadRollGain);
    roadRollGain.connect(ctx.destination);
    roadRollSrc.start();

    // 1d. Silky Filtered-Air Turbo Spool (soft high-Q filtered air rush, NEVER a piercing sine mosquito!)
    const turboAirSrc = ctx.createBufferSource();
    turboAirSrc.buffer = noiseBuf;
    turboAirSrc.loop = true;
    const turboAirFilter = ctx.createBiquadFilter();
    turboAirFilter.type = 'bandpass';
    turboAirFilter.frequency.value = 1600;
    turboAirFilter.Q.value = 5.5;
    const turboAirGain = ctx.createGain();
    turboAirGain.gain.value = 0;
    turboAirSrc.connect(turboAirFilter);
    turboAirFilter.connect(turboAirGain);
    turboAirGain.connect(ctx.destination);
    turboAirSrc.start();

    this.engineOscA = oscA;
    this.engineOscB = oscB;
    this.engineSubOsc = subOsc;
    this.engineOscAGain = oscAGain;
    this.engineOscBGain = oscBGain;
    this.engineSubGain = subGain;
    this.engineResonator = resonator;
    this.engineMuffler1 = muffler1;
    this.engineMuffler2 = muffler2;
    this.engineGain = engineGain;
    this.exhaustNoiseFilter = exhaustNoiseFilter;
    this.exhaustNoiseGain = exhaustNoiseGain;
    this.roadRollFilter = roadRollFilter;
    this.roadRollGain = roadRollGain;
    this.turboAirFilter = turboAirFilter;
    this.turboAirGain = turboAirGain;

    // 2. Tire drift screech (filtered looping noise)
    const driftNoiseSrc = ctx.createBufferSource();
    driftNoiseSrc.buffer = noiseBuf;
    driftNoiseSrc.loop = true;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1350;
    bandpass.Q.value = 4.2;

    const driftGain = ctx.createGain();
    driftGain.gain.value = 0;

    driftNoiseSrc.connect(bandpass);
    bandpass.connect(driftGain);
    driftGain.connect(ctx.destination);
    driftNoiseSrc.start();
    this.driftGain = driftGain;

    // 3. Dual-tone modern car horn
    const hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    const hornA = ctx.createOscillator();
    hornA.type = 'sawtooth';
    hornA.frequency.value = 405;
    const hornB = ctx.createOscillator();
    hornB.type = 'sawtooth';
    hornB.frequency.value = 505;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 1400;

    hornA.connect(hornFilter);
    hornB.connect(hornFilter);
    hornFilter.connect(hornGain);
    hornGain.connect(ctx.destination);
    hornA.start();
    hornB.start();

    this.hornOscA = hornA;
    this.hornOscB = hornB;
    this.hornGain = hornGain;

    // 4. Spatialized passing AI traffic car hum + road tire roll
    const trafficOsc = ctx.createOscillator();
    trafficOsc.type = 'triangle';
    trafficOsc.frequency.value = 72;

    const trafficNoise = ctx.createBufferSource();
    trafficNoise.buffer = noiseBuf;
    trafficNoise.loop = true;

    const trafficNoiseGain = ctx.createGain();
    trafficNoiseGain.gain.value = 0.42;

    const trafficFilter = ctx.createBiquadFilter();
    trafficFilter.type = 'lowpass';
    trafficFilter.frequency.value = 340;

    const trafficGain = ctx.createGain();
    trafficGain.gain.value = 0;

    const trafficPanner = ctx.createStereoPanner();
    trafficPanner.pan.value = 0;

    trafficOsc.connect(trafficFilter);
    trafficNoise.connect(trafficNoiseGain);
    trafficNoiseGain.connect(trafficFilter);
    trafficFilter.connect(trafficGain);
    trafficGain.connect(trafficPanner);
    trafficPanner.connect(ctx.destination);
    trafficOsc.start();
    trafficNoise.start();

    this.trafficOsc = trafficOsc;
    this.trafficFilter = trafficFilter;
    this.trafficGain = trafficGain;
    this.trafficPanner = trafficPanner;

    // 5. Gentle coastal Atlantic surf bed (velvety pink noise waves)
    const oceanNoise = ctx.createBufferSource();
    oceanNoise.buffer = warmBuf;
    oceanNoise.loop = true;

    const oceanFilter = ctx.createBiquadFilter();
    oceanFilter.type = 'lowpass';
    oceanFilter.frequency.value = 320;
    oceanFilter.Q.value = 0.7;

    const oceanGain = ctx.createGain();
    oceanGain.gain.value = 0;

    oceanNoise.connect(oceanFilter);
    oceanFilter.connect(oceanGain);
    oceanGain.connect(ctx.destination);
    oceanNoise.start();

    this.oceanFilter = oceanFilter;
    this.oceanGain = oceanGain;

    // 6. Muffled Club Neon deep sub-bass pulse
    const clubOsc = ctx.createOscillator();
    clubOsc.type = 'sine';
    clubOsc.frequency.value = 54;

    const clubGain = ctx.createGain();
    clubGain.gain.value = 0;

    clubOsc.connect(clubGain);
    clubGain.connect(ctx.destination);
    clubOsc.start();

    this.clubOsc = clubOsc;
    this.clubGain = clubGain;
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.silenceContinuous();
    }
    return this.enabled;
  }

  public silenceContinuous(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, now, 0.05);
    this.exhaustNoiseGain?.gain.setTargetAtTime(0, now, 0.05);
    this.roadRollGain?.gain.setTargetAtTime(0, now, 0.06);
    this.turboAirGain?.gain.setTargetAtTime(0, now, 0.05);
    this.driftGain?.gain.setTargetAtTime(0, now, 0.04);
    this.hornGain?.gain.setTargetAtTime(0, now, 0.03);
    this.trafficGain?.gain.setTargetAtTime(0, now, 0.08);
    this.oceanGain?.gain.setTargetAtTime(0, now, 0.12);
    this.clubGain?.gain.setTargetAtTime(0, now, 0.08);
  }

  public updateDriving(
    inCar: boolean,
    rpmNorm: number,
    throttle: number,
    driftAmount: number,
    horn: boolean,
    profile: EngineSoundProfile = 'exotic-v12',
    shiftActive = false,
    speedNorm = 0,
  ): void {
    if (!this.ctx || !this.enabled) {
      this.silenceContinuous();
      return;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;
    if (!inCar) {
      this.engineGain?.gain.setTargetAtTime(0, now, 0.05);
      this.exhaustNoiseGain?.gain.setTargetAtTime(0, now, 0.05);
      this.roadRollGain?.gain.setTargetAtTime(0, now, 0.06);
      this.turboAirGain?.gain.setTargetAtTime(0, now, 0.05);
      this.driftGain?.gain.setTargetAtTime(0, now, 0.04);
      this.hornGain?.gain.setTargetAtTime(0, now, 0.03);
      return;
    }

    // Load the custom band-limited PeriodicWave for this car's cylinder architecture
    if (this.activeEngineProfile !== profile && this.engineOscA && this.engineOscB) {
      this.activeEngineProfile = profile;
      const wave = this.engineWaveMap[profile] ?? this.engineWaveMap['sport-v6'];
      if (wave) {
        this.engineOscA.setPeriodicWave(wave);
        this.engineOscB.setPeriodicWave(wave);
      }
    }

    const rpm = clamp(rpmNorm, 0.04, 1.05);
    const spd = clamp(speedNorm, 0, 1.1);
    const load = clamp(Math.abs(throttle), 0, 1);

    // Warm, realistic acoustic firing frequencies & exhaust-muffler voicings per engine family
    let idleHz = 36;
    let redlineHz = 145;
    let bankRatio = 1.008; // Slight cylinder-bank detune gives real organic mechanical beat!
    let subRatio = 0.5;
    let subLvl = 0.45;
    let resHz = 180;
    let mufBase = 210;
    let mufSpan = 520;
    let baseVol = 0.052;
    let airVol = 0.024;
    let turboVol = 0;

    if (profile === 'exotic-v12') {
      // Singing Italian V12: crisp, creamy harmonic rise up to ~225Hz fundamental (rich 450-900Hz harmonics)
      idleHz = 52;
      redlineHz = 228;
      bankRatio = 1.498; // Perfect 5th cylinder-bank singing overtone!
      subRatio = 0.5;
      subLvl = 0.34;
      resHz = 280;
      mufBase = 320;
      mufSpan = 920;
      baseVol = 0.052;
      airVol = 0.026;
    } else if (profile === 'muscle-v8') {
      // Deep rumbling cross-plane V8: chesty 30-118Hz firing rumble + throaty exhaust air!
      idleHz = 30;
      redlineHz = 118;
      bankRatio = 1.028; // Authentic cross-plane uneven V8 lope/burble!
      subRatio = 0.5;
      subLvl = 0.68;
      resHz = 135;
      mufBase = 175;
      mufSpan = 480;
      baseVol = 0.062;
      airVol = 0.032;
      turboVol = 0.008;
    } else if (profile === 'flat6') {
      // Warm metallic boxer flat-6 bark
      idleHz = 42;
      redlineHz = 178;
      bankRatio = 1.335;
      subRatio = 0.5;
      subLvl = 0.42;
      resHz = 225;
      mufBase = 260;
      mufSpan = 740;
      baseVol = 0.05;
      airVol = 0.026;
    } else if (profile === 'turbo-jdm') {
      // Zippy tuned turbo inline-6/4 + silky filtered-air spool rush
      idleHz = 44;
      redlineHz = 188;
      bankRatio = 1.012;
      subRatio = 0.5;
      subLvl = 0.4;
      resHz = 210;
      mufBase = 240;
      mufSpan = 720;
      baseVol = 0.048;
      airVol = 0.028;
      turboVol = 0.018;
    } else if (profile === 'sport-v6') {
      // Refined smooth GT V6 purr
      idleHz = 36;
      redlineHz = 146;
      bankRatio = 1.252;
      subRatio = 0.5;
      subLvl = 0.46;
      resHz = 175;
      mufBase = 200;
      mufSpan = 560;
      baseVol = 0.046;
      airVol = 0.02;
    } else if (profile === 'electric-ev') {
      // Quiet, silky futuristic EV motor hum (completely silent at standstill, smooth warm rise)
      idleHz = 88;
      redlineHz = 360;
      bankRatio = 1.5;
      subRatio = 0.5;
      subLvl = 0.25;
      resHz = 320;
      mufBase = 300;
      mufSpan = 780;
      baseVol = 0.024;
      airVol = 0.006;
      turboVol = 0.006;
    } else if (profile === 'heavy-v8') {
      // Low, bassy 2.35-ton luxury SUV V8 rumble
      idleHz = 26;
      redlineHz = 96;
      bankRatio = 1.022;
      subRatio = 0.5;
      subLvl = 0.74;
      resHz = 115;
      mufBase = 140;
      mufSpan = 360;
      baseVol = 0.06;
      airVol = 0.024;
    } else {
      // commuter-i4 (Sol City Taxi) — subtle, calm everyday sedan hum
      idleHz = 34;
      redlineHz = 122;
      bankRatio = 1.008;
      subRatio = 0.5;
      subLvl = 0.44;
      resHz = 165;
      mufBase = 175;
      mufSpan = 410;
      baseVol = 0.04;
      airVol = 0.016;
    }

    const freq = idleHz + (redlineHz - idleHz) * rpm;
    const shiftDip = shiftActive && profile !== 'electric-ev' ? 0.42 : 1.0;

    this.engineOscA?.frequency.setTargetAtTime(freq, now, 0.025);
    this.engineOscB?.frequency.setTargetAtTime(freq * bankRatio, now, 0.025);
    this.engineSubOsc?.frequency.setTargetAtTime(freq * subRatio, now, 0.025);
    this.engineOscAGain?.gain.setTargetAtTime(0.56, now, 0.04);
    this.engineOscBGain?.gain.setTargetAtTime(profile === 'electric-ev' ? 0.28 : 0.44, now, 0.04);
    this.engineSubGain?.gain.setTargetAtTime(subLvl, now, 0.04);

    // Dynamic muffler cutoff: opens up warmly under throttle & high RPM, mellows down when coasting!
    const mufCutoff = mufBase + mufSpan * (rpm * 0.62 + load * 0.42);
    this.engineResonator?.frequency.setTargetAtTime(resHz + rpm * 65, now, 0.04);
    this.engineMuffler1?.frequency.setTargetAtTime(mufCutoff, now, 0.03);
    this.engineMuffler2?.frequency.setTargetAtTime(mufCutoff * 1.45, now, 0.03);

    const engVol =
      profile === 'electric-ev'
        ? baseVol * clamp((rpm - 0.05) * 1.15, 0, 1) * (0.55 + load * 0.55)
        : (baseVol * 0.36 + baseVol * 0.48 * load + baseVol * 0.34 * rpm) * shiftDip;
    this.engineGain?.gain.setTargetAtTime(engVol, now, 0.035);

    // Mechanical exhaust/intake breath noise tied to RPM + throttle load
    const exVol =
      profile === 'electric-ev'
        ? airVol * spd
        : airVol * (0.18 + rpm * 0.55 + load * 0.65) * shiftDip;
    this.exhaustNoiseFilter?.frequency.setTargetAtTime(160 + rpm * 420 + load * 180, now, 0.04);
    this.exhaustNoiseGain?.gain.setTargetAtTime(exVol, now, 0.04);

    // Warm asphalt tire-roll & wind rush scaling smoothly with vehicle speed (grounds every car!)
    const rollVol = clamp(spd * spd * 0.036 + spd * 0.012, 0, 0.044);
    this.roadRollFilter?.frequency.setTargetAtTime(180 + spd * 340, now, 0.08);
    this.roadRollGain?.gain.setTargetAtTime(rollVol, now, 0.08);

    // Silky filtered-air turbo spool rush (no annoying sine whistle!)
    if (turboVol > 0) {
      const tAir =
        profile === 'electric-ev'
          ? turboVol * clamp((rpm - 0.1) * 1.1, 0, 1)
          : turboVol * clamp((rpm - 0.38) * 1.5, 0, 1) * (0.25 + load * 0.85) * shiftDip;
      this.turboAirFilter?.frequency.setTargetAtTime(1150 + rpm * 1450, now, 0.045);
      this.turboAirGain?.gain.setTargetAtTime(tAir, now, 0.05);
    } else {
      this.turboAirGain?.gain.setTargetAtTime(0, now, 0.05);
    }

    const driftVol = clamp(driftAmount * 0.075, 0, 0.075);
    this.driftGain?.gain.setTargetAtTime(driftVol, now, 0.04);

    this.hornGain?.gain.setTargetAtTime(horn ? 0.065 : 0, now, 0.02);
    void this.hornOscA;
    void this.hornOscB;
  }

  /**
   * Subtle, organic exhaust/air transients accompanying real gear shifts
   * (main pitch drop / rev-match comes naturally from the engine voice itself — zero cheesy synth beeps!).
   */
  public playGearShift(profile: EngineSoundProfile, kind: 'up' | 'down'): void {
    if (!this.ctx || !this.noiseBuf || !this.enabled || profile === 'electric-ev') return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;

    if (kind === 'up') {
      if (profile === 'turbo-jdm') {
        // Clean, subtle pneumatic blow-off air release ("tssh")
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1950, now);
        bp.frequency.exponentialRampToValueAtTime(1100, now + 0.14);
        bp.Q.value = 3.2;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0008, now);
        g.gain.linearRampToValueAtTime(0.032, now + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0005, now + 0.15);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.ctx.destination);
        src.start(now, Math.random() * 1.2, 0.16);
      } else if (profile === 'exotic-v12' || profile === 'muscle-v8' || profile === 'flat6') {
        // Warm, muted dual-clutch exhaust pressure puff (lowpass filtered, no harsh buzz)
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = profile === 'muscle-v8' ? 280 : 440;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.038, now + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0006, now + 0.075);
        src.connect(lp);
        lp.connect(g);
        g.connect(this.ctx.destination);
        src.start(now, Math.random() * 1.2, 0.085);
      } else {
        // Very subtle muted mechanical shift thump on V6 / Taxi / SUV
        const thud = this.ctx.createOscillator();
        const tg = this.ctx.createGain();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(78, now);
        thud.frequency.exponentialRampToValueAtTime(42, now + 0.055);
        tg.gain.setValueAtTime(0.001, now);
        tg.gain.linearRampToValueAtTime(0.022, now + 0.006);
        tg.gain.exponentialRampToValueAtTime(0.0006, now + 0.06);
        thud.connect(tg);
        tg.connect(this.ctx.destination);
        thud.start(now);
        thud.stop(now + 0.07);
      }
    } else {
      // Downshift: subtle warm exhaust overrun puff while the main engine voice smoothly rev-matches up!
      const isSporty =
        profile === 'exotic-v12' || profile === 'muscle-v8' || profile === 'flat6' || profile === 'turbo-jdm';
      if (!isSporty) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = profile === 'muscle-v8' ? 210 : 340;
      bp.Q.value = 1.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.028, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 0.09);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.ctx.destination);
      src.start(now, Math.random() * 1.2, 0.1);
    }
  }

  /** Updates subtle continuous spatialized ambience (passing traffic hum, ocean surf, Club Neon bass). */
  public updateWorldAmbience(params: WorldAmbienceParams): void {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;

    // Passing traffic tire/engine roll (more audible on foot, subtly attenuated inside a car cabin or indoors)
    if (params.nearestTraffic && params.nearestTraffic.gain > 0.005) {
      const cabinAtten = params.inInteriorId ? 0.22 : params.inCar ? 0.45 : 1.0;
      const spdFactor = clamp(params.nearestTraffic.speedMps / 16, 0.25, 1.25);
      const vol = params.nearestTraffic.gain * 0.028 * spdFactor * cabinAtten;
      this.trafficGain?.gain.setTargetAtTime(vol, now, 0.07);
      this.trafficPanner?.pan.setTargetAtTime(params.nearestTraffic.pan, now, 0.06);
      this.trafficOsc?.frequency.setTargetAtTime(52 + spdFactor * 44, now, 0.08);
      this.trafficFilter?.frequency.setTargetAtTime(220 + spdFactor * 260, now, 0.08);
    } else {
      this.trafficGain?.gain.setTargetAtTime(0, now, 0.09);
    }

    // Gentle coastal ocean surf swell (7-second natural wave cycle)
    if (params.oceanProximity > 0.02 && !params.inInteriorId) {
      const swell = 0.62 + 0.38 * Math.sin(params.elapsed * 0.85);
      const carAtten = params.inCar ? 0.45 : 1.0;
      const vol = params.oceanProximity * swell * 0.024 * carAtten;
      this.oceanGain?.gain.setTargetAtTime(vol, now, 0.14);
      this.oceanFilter?.frequency.setTargetAtTime(240 + swell * 190, now, 0.16);
    } else {
      this.oceanGain?.gain.setTargetAtTime(0, now, 0.15);
    }

    // Subtle muffled Club Neon 124 BPM sub-bass pulse inside or right outside the nightclub
    if (params.clubProximity > 0.04) {
      const beatPhase = (params.elapsed * (124 / 60)) % 1;
      const kickEnv = Math.exp(-beatPhase * 8.5);
      const vol = params.clubProximity * kickEnv * 0.052;
      this.clubOsc?.frequency.setTargetAtTime(48 + kickEnv * 26, now, 0.015);
      this.clubGain?.gain.setTargetAtTime(vol, now, 0.015);
    } else {
      this.clubGain?.gain.setTargetAtTime(0, now, 0.1);
    }
  }

  /**
   * Understated, realistic surface-aware footstep (works for both the player and nearby spatialized NPCs).
   */
  public playFootstep(
    surface: FootstepSurface,
    volume = 1.0,
    pan = 0,
    isSprint = false,
    isAmbientNpc = false,
  ): void {
    if (!this.ctx || !this.noiseBuf || !this.enabled || volume <= 0.02) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;
    if (isAmbientNpc) {
      if (now - this.lastNpcStepTime < 0.085) return;
      this.lastNpcStepTime = now;
    } else {
      if (now - this.lastPlayerStepTime < 0.135) return;
      this.lastPlayerStepTime = now;
    }

    // Subtle natural step-to-step pitch & amplitude jitter so walking never sounds robotic
    const jitter = 0.9 + Math.random() * 0.2;
    const sprintBoost = isSprint ? 1.32 : 1.0;
    const v = clamp(volume, 0.02, 1.2) * sprintBoost;

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -0.88, 0.88);
    panner.connect(this.ctx.destination);

    // 1. Filtered shoe-scuff noise transient (reusing shared noiseBuf at a random offset)
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const filter = this.ctx.createBiquadFilter();
    const nGain = this.ctx.createGain();
    let dur = 0.055;
    let noiseVol = 0.042;
    let thumpHz = 115;
    let thumpVol = 0.032;

    if (surface === 'sand') {
      filter.type = 'lowpass';
      filter.frequency.value = 720 * jitter;
      filter.Q.value = 0.6;
      dur = 0.095;
      noiseVol = 0.052;
      thumpVol = 0.0; // Sand has soft granular crunch, no hard heel knock
    } else if (surface === 'wood') {
      filter.type = 'bandpass';
      filter.frequency.value = 460 * jitter;
      filter.Q.value = 1.6;
      dur = 0.065;
      noiseVol = 0.048;
      thumpHz = 148 * jitter;
      thumpVol = 0.044;
    } else if (surface === 'tile') {
      filter.type = 'bandpass';
      filter.frequency.value = 1520 * jitter;
      filter.Q.value = 2.2;
      dur = 0.045;
      noiseVol = 0.042;
      thumpHz = 162 * jitter;
      thumpVol = 0.034;
    } else if (surface === 'carpet') {
      filter.type = 'lowpass';
      filter.frequency.value = 310 * jitter;
      filter.Q.value = 0.7;
      dur = 0.058;
      noiseVol = 0.032;
      thumpHz = 86 * jitter;
      thumpVol = 0.02;
    } else {
      // concrete / asphalt
      filter.type = 'bandpass';
      filter.frequency.value = 840 * jitter;
      filter.Q.value = 1.1;
      dur = 0.052;
      noiseVol = 0.044;
      thumpHz = 118 * jitter;
      thumpVol = 0.032;
    }

    const startOffset = Math.random() * 1.4;
    nGain.gain.setValueAtTime(0.0008, now);
    nGain.gain.linearRampToValueAtTime(noiseVol * v, now + 0.006);
    nGain.gain.exponentialRampToValueAtTime(0.0005, now + dur);

    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(panner);
    src.start(now, startOffset, dur + 0.01);

    // 2. Subtle damped heel-weight body thud (gives steps real physical grounding)
    if (thumpVol > 0.001) {
      const osc = this.ctx.createOscillator();
      const oGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(thumpHz, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(42, thumpHz * 0.42), now + 0.048);

      oGain.gain.setValueAtTime(0.0008, now);
      oGain.gain.linearRampToValueAtTime(thumpVol * v, now + 0.005);
      oGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.052);

      osc.connect(oGain);
      oGain.connect(panner);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  }

  /** Subtle push-off scuff when jumping on foot. */
  public playJump(surface: FootstepSurface): void {
    this.playFootstep(surface, 0.75, 0, true, false);
  }

  /** Grounded two-foot landing thud scaled gently by fall speed. */
  public playLand(surface: FootstepSurface, impactNorm = 0.65): void {
    if (!this.ctx || !this.noiseBuf || !this.enabled) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;
    const strength = clamp(impactNorm, 0.25, 1.0);

    // Low kinetic landing thump
    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = 'sine';
    const startHz = surface === 'wood' ? 125 : surface === 'sand' || surface === 'carpet' ? 78 : 102;
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.095);
    oGain.gain.setValueAtTime(0.001, now);
    oGain.gain.linearRampToValueAtTime(0.085 * strength, now + 0.007);
    oGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.11);
    osc.connect(oGain);
    oGain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);

    // Matching surface scuff
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = surface === 'sand' || surface === 'carpet' ? 'lowpass' : 'bandpass';
    filter.frequency.value = surface === 'sand' ? 620 : surface === 'tile' ? 1200 : 680;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now);
    nGain.gain.linearRampToValueAtTime(0.06 * strength, now + 0.006);
    nGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.09);
    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.ctx.destination);
    src.start(now, Math.random() * 1.2, 0.1);
  }

  /** Realistic mechanical door latch / car door thud / warm brass hotel elevator bell. */
  public playDoorLatch(kind: 'car' | 'room' | 'elevator'): void {
    if (!this.ctx || !this.noiseBuf || !this.enabled) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;

    if (kind === 'elevator') {
      // Classic warm brass hotel elevator bell ("ding!")
      for (const [freq, amp, decay] of [
        [1046.5, 0.075, 0.65],
        [2093.0, 0.025, 0.38],
      ] as const) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0008, now);
        g.gain.linearRampToValueAtTime(amp, now + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0006, now + decay);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + decay + 0.02);
      }
      return;
    }

    // Crisp metallic latch click
    const clickSrc = this.ctx.createBufferSource();
    clickSrc.buffer = this.noiseBuf;
    const clickFilter = this.ctx.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = kind === 'car' ? 1850 : 1250;
    clickFilter.Q.value = 3.0;
    const clickGain = this.ctx.createGain();
    clickGain.gain.setValueAtTime(0.001, now);
    clickGain.gain.linearRampToValueAtTime(0.055, now + 0.004);
    clickGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.032);
    clickSrc.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.ctx.destination);
    clickSrc.start(now, Math.random() * 1.2, 0.04);

    // Solid door shut thump slightly after handle latch
    const tClose = now + (kind === 'car' ? 0.065 : 0.035);
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(kind === 'car' ? 115 : 155, tClose);
    thud.frequency.exponentialRampToValueAtTime(kind === 'car' ? 38 : 56, tClose + 0.095);
    thudGain.gain.setValueAtTime(0.001, tClose);
    thudGain.gain.linearRampToValueAtTime(kind === 'car' ? 0.14 : 0.065, tClose + 0.007);
    thudGain.gain.exponentialRampToValueAtTime(0.0006, tClose + 0.11);
    thud.connect(thudGain);
    thudGain.connect(this.ctx.destination);
    thud.start(tClose);
    thud.stop(tClose + 0.12);
  }

  public playChime(kind: 'checkpoint' | 'complete' | 'enter' | 'paint' | 'fail'): void {
    if (!this.ctx || !this.enabled) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;
    const notes: Record<typeof kind, number[]> = {
      checkpoint: [587.33, 880],
      complete: [523.25, 659.25, 783.99, 1046.5],
      enter: [330, 440],
      paint: [440, 554.37, 659.25],
      fail: [311.13, 233.08],
    };

    notes[kind].forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = kind === 'fail' ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      const t0 = now + idx * 0.075;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.09, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.24);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.26);
    });
  }

  /**
   * Realistic synthesized impact audio for shoulder bumps, car-hits-person thuds,
   * and metallic vehicle fender-bender collisions. Cooldown-gated to prevent audio clipping.
   */
  public playImpact(kind: 'bump' | 'body' | 'car', intensity = 0.6): void {
    if (!this.ctx || !this.enabled) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;
    if (now - this.lastImpactTime < 0.085) return;
    this.lastImpactTime = now;

    const strength = clamp(intensity, 0.15, 1.0);

    // Low-end kinetic thump (sine pitch-drop)
    const thump = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thump.type = kind === 'car' ? 'triangle' : 'sine';
    const startHz = kind === 'car' ? 145 : kind === 'body' ? 120 : 95;
    const endHz = kind === 'car' ? 36 : 30;
    thump.frequency.setValueAtTime(startHz, now);
    thump.frequency.exponentialRampToValueAtTime(endHz, now + 0.14);

    const vol = (kind === 'bump' ? 0.14 : kind === 'body' ? 0.24 : 0.28) * strength;
    thumpGain.gain.setValueAtTime(0.001, now);
    thumpGain.gain.linearRampToValueAtTime(vol, now + 0.008);
    thumpGain.gain.exponentialRampToValueAtTime(0.0008, now + (kind === 'car' ? 0.22 : 0.16));

    thump.connect(thumpGain);
    thumpGain.connect(this.ctx.destination);
    thump.start(now);
    thump.stop(now + 0.24);

    // Brief filtered noise crunch for car metal or heavy body knockdowns
    if ((kind === 'car' || kind === 'body') && this.noiseBuf) {
      const dur = kind === 'car' ? 0.18 : 0.1;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;

      const filter = this.ctx.createBiquadFilter();
      filter.type = kind === 'car' ? 'bandpass' : 'lowpass';
      filter.frequency.value = kind === 'car' ? 780 : 420;
      filter.Q.value = kind === 'car' ? 1.4 : 0.9;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime((kind === 'car' ? 0.2 : 0.12) * strength, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      src.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.ctx.destination);
      src.start(now, Math.random() * 1.2, dur + 0.01);
    }
  }
}
