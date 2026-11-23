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

  // Player vehicle multi-voice engine + turbo + drift + horn continuous nodes
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineHarm: OscillatorNode | null = null;
  private engineHarmGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
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

    // Shared 2-second white-noise buffer reused across drift, footsteps, surf, and impacts (zero GC allocs!)
    const bufLen = Math.floor(ctx.sampleRate * 2.0);
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuf = noiseBuf;

    // 1. Multi-voice per-car engine synthesizer (primary firing + sub exhaust + upper harmonic + turbo spool)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 460;
    filter.Q.value = 1.1;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 64;

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = 32;

    const harm = ctx.createOscillator();
    harm.type = 'sawtooth';
    harm.frequency.value = 128;

    const harmGain = ctx.createGain();
    harmGain.gain.value = 0.25;

    osc.connect(filter);
    sub.connect(filter);
    harm.connect(harmGain);
    harmGain.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(ctx.destination);
    osc.start();
    sub.start();
    harm.start();

    // Subtle high-frequency turbocharger spool / EV inverter harmonic voice
    const turboOsc = ctx.createOscillator();
    turboOsc.type = 'sine';
    turboOsc.frequency.value = 1400;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboOsc.connect(turboGain);
    turboGain.connect(ctx.destination);
    turboOsc.start();

    this.engineOsc = osc;
    this.engineSub = sub;
    this.engineHarm = harm;
    this.engineHarmGain = harmGain;
    this.engineFilter = filter;
    this.engineGain = engineGain;
    this.turboOsc = turboOsc;
    this.turboGain = turboGain;

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

    // 5. Gentle coastal Atlantic surf bed
    const oceanNoise = ctx.createBufferSource();
    oceanNoise.buffer = noiseBuf;
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
    this.turboGain?.gain.setTargetAtTime(0, now, 0.05);
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
      this.turboGain?.gain.setTargetAtTime(0, now, 0.05);
      this.driftGain?.gain.setTargetAtTime(0, now, 0.04);
      this.hornGain?.gain.setTargetAtTime(0, now, 0.03);
      return;
    }

    // Reconfigure oscillator waveforms cleanly when switching car archetypes
    if (this.activeEngineProfile !== profile && this.engineOsc && this.engineSub && this.engineHarm) {
      this.activeEngineProfile = profile;
      if (profile === 'electric-ev') {
        this.engineOsc.type = 'sine';
        this.engineSub.type = 'triangle';
        this.engineHarm.type = 'sine';
      } else if (profile === 'muscle-v8' || profile === 'heavy-v8') {
        this.engineOsc.type = 'sawtooth';
        this.engineSub.type = 'square';
        this.engineHarm.type = 'sawtooth';
      } else if (profile === 'exotic-v12' || profile === 'flat6') {
        this.engineOsc.type = 'sawtooth';
        this.engineSub.type = 'triangle';
        this.engineHarm.type = 'sawtooth';
      } else {
        this.engineOsc.type = 'sawtooth';
        this.engineSub.type = 'triangle';
        this.engineHarm.type = 'triangle';
      }
    }

    const rpm = clamp(rpmNorm, 0.04, 1.05);
    const load = clamp(Math.abs(throttle), 0, 1);

    // Per-car acoustic synthesis parameters (idleHz, redlineHz, subRatio, harmRatio, harmLevel, filterBase, filterSpan, baseVol, turboLevel)
    let idleHz = 56;
    let redlineHz = 220;
    let subRatio = 0.5;
    let harmRatio = 2.0;
    let harmLevel = 0.25;
    let filterBase = 260;
    let filterSpan = 850;
    let baseVol = 0.045;
    let turboLevel = 0;

    if (profile === 'exotic-v12') {
      // High-pitched Italian V12 wail with singing 3rd harmonic!
      idleHz = 76;
      redlineHz = 365;
      subRatio = 0.5;
      harmRatio = 1.5;
      harmLevel = 0.44;
      filterBase = 420;
      filterSpan = 1650;
      baseVol = 0.052;
    } else if (profile === 'muscle-v8') {
      // Throaty rumbling cross-plane twin-turbo V8 growl!
      idleHz = 40;
      redlineHz = 178;
      subRatio = 0.506; // Slight detune creates authentic V8 burble beat!
      harmRatio = 1.49;
      harmLevel = 0.36;
      filterBase = 220;
      filterSpan = 880;
      baseVol = 0.056;
      turboLevel = 0.008;
    } else if (profile === 'flat6') {
      // Metallic raspy boxer flat-6 bark!
      idleHz = 60;
      redlineHz = 278;
      subRatio = 0.5;
      harmRatio = 2.02;
      harmLevel = 0.38;
      filterBase = 360;
      filterSpan = 1350;
      baseVol = 0.048;
    } else if (profile === 'turbo-jdm') {
      // Zippy high-revving tuner coupe + distinct spooling turbo whistle!
      idleHz = 64;
      redlineHz = 295;
      subRatio = 0.5;
      harmRatio = 2.0;
      harmLevel = 0.3;
      filterBase = 340;
      filterSpan = 1280;
      baseVol = 0.046;
      turboLevel = 0.015;
    } else if (profile === 'sport-v6') {
      // Smooth, warm grand-touring V6 purr
      idleHz = 50;
      redlineHz = 218;
      subRatio = 0.5;
      harmRatio = 1.5;
      harmLevel = 0.24;
      filterBase = 290;
      filterSpan = 960;
      baseVol = 0.044;
    } else if (profile === 'electric-ev') {
      // Futuristic clean dual-motor electric inverter whine (silent at standstill!)
      idleHz = 135;
      redlineHz = 780;
      subRatio = 0.5;
      harmRatio = 2.0;
      harmLevel = 0.32;
      filterBase = 550;
      filterSpan = 2200;
      baseVol = 0.036;
      turboLevel = 0.012;
    } else if (profile === 'heavy-v8') {
      // Deep, bassy luxury SUV V8 rumble
      idleHz = 32;
      redlineHz = 132;
      subRatio = 0.505;
      harmRatio = 1.5;
      harmLevel = 0.28;
      filterBase = 170;
      filterSpan = 560;
      baseVol = 0.055;
    } else {
      // commuter-i4 (Sol City Taxi)
      idleHz = 46;
      redlineHz = 168;
      subRatio = 0.5;
      harmRatio = 2.0;
      harmLevel = 0.18;
      filterBase = 230;
      filterSpan = 640;
      baseVol = 0.04;
    }

    const freq = idleHz + (redlineHz - idleHz) * rpm;
    const shiftDip = shiftActive && profile !== 'electric-ev' ? 0.52 : 1.0;

    this.engineOsc?.frequency.setTargetAtTime(freq, now, 0.025);
    this.engineSub?.frequency.setTargetAtTime(freq * subRatio, now, 0.025);
    this.engineHarm?.frequency.setTargetAtTime(freq * harmRatio, now, 0.025);
    this.engineHarmGain?.gain.setTargetAtTime(harmLevel * (0.65 + rpm * 0.45), now, 0.03);
    this.engineFilter?.frequency.setTargetAtTime(
      filterBase + filterSpan * (rpm * 0.72 + load * 0.35),
      now,
      0.03,
    );

    const vol =
      profile === 'electric-ev'
        ? baseVol * clamp((rpm - 0.05) * 1.15, 0, 1) * (0.6 + load * 0.55)
        : (baseVol * 0.42 + baseVol * 0.55 * load + baseVol * 0.38 * rpm) * shiftDip;
    this.engineGain?.gain.setTargetAtTime(vol, now, 0.03);

    // Turbo spool whine (JDM / twin-turbo V8) or high-frequency EV inverter shimmer
    if (turboLevel > 0) {
      const turboFreq = profile === 'electric-ev' ? 680 + rpm * 1950 : 1250 + rpm * 2100;
      const turboVol =
        profile === 'electric-ev'
          ? turboLevel * clamp((rpm - 0.08) * 1.1, 0, 1)
          : turboLevel * clamp((rpm - 0.35) * 1.4, 0, 1) * (0.35 + load * 0.85) * shiftDip;
      this.turboOsc?.frequency.setTargetAtTime(turboFreq, now, 0.04);
      this.turboGain?.gain.setTargetAtTime(turboVol, now, 0.05);
    } else {
      this.turboGain?.gain.setTargetAtTime(0, now, 0.05);
    }

    const driftVol = clamp(driftAmount * 0.075, 0, 0.075);
    this.driftGain?.gain.setTargetAtTime(driftVol, now, 0.04);

    this.hornGain?.gain.setTargetAtTime(horn ? 0.065 : 0, now, 0.02);
    void this.hornOscA;
    void this.hornOscB;
  }

  /**
   * Plays authentic upshift / downshift mechanical & exhaust transients per car class:
   * - Exotic V12 / V8 / Flat-6: crisp dual-clutch bark or exhaust crackle on upshift + rev-match blip on downshift!
   * - Turbo JDM: iconic blow-off valve ("pssh-tu-tu!") air release on upshift!
   * - Commuter / SUV: subtle mechanical transmission thump!
   */
  public playGearShift(profile: EngineSoundProfile, kind: 'up' | 'down'): void {
    if (!this.ctx || !this.noiseBuf || !this.enabled || profile === 'electric-ev') return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    const now = this.ctx.currentTime;

    if (kind === 'up') {
      if (profile === 'turbo-jdm') {
        // Iconic turbo blow-off valve flutter ("pssh-tu-tu!")
        for (let i = 0; i < 3; i++) {
          const t0 = now + i * 0.048;
          const src = this.ctx.createBufferSource();
          src.buffer = this.noiseBuf;
          const bp = this.ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(2400 - i * 320, t0);
          bp.Q.value = 3.2;
          const g = this.ctx.createGain();
          const amp = (0.048 - i * 0.012);
          g.gain.setValueAtTime(0.0008, t0);
          g.gain.linearRampToValueAtTime(amp, t0 + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.055);
          src.connect(bp);
          bp.connect(g);
          g.connect(this.ctx.destination);
          src.start(t0, Math.random() * 1.2, 0.065);
        }
      } else if (profile === 'exotic-v12' || profile === 'muscle-v8' || profile === 'flat6') {
        // Crisp dual-clutch / sport exhaust upshift bark & subtle pop!
        const bark = this.ctx.createOscillator();
        const bGain = this.ctx.createGain();
        bark.type = 'sawtooth';
        const fStart = profile === 'exotic-v12' ? 240 : profile === 'flat6' ? 195 : 135;
        bark.frequency.setValueAtTime(fStart, now);
        bark.frequency.exponentialRampToValueAtTime(fStart * 0.45, now + 0.075);
        const filt = this.ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = profile === 'exotic-v12' ? 950 : 620;
        bGain.gain.setValueAtTime(0.001, now);
        bGain.gain.linearRampToValueAtTime(0.055, now + 0.007);
        bGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.085);
        bark.connect(filt);
        filt.connect(bGain);
        bGain.connect(this.ctx.destination);
        bark.start(now);
        bark.stop(now + 0.095);

        // Brief exhaust burble pop
        const popSrc = this.ctx.createBufferSource();
        popSrc.buffer = this.noiseBuf;
        const popBp = this.ctx.createBiquadFilter();
        popBp.type = 'bandpass';
        popBp.frequency.value = profile === 'muscle-v8' ? 320 : 540;
        popBp.Q.value = 1.6;
        const popG = this.ctx.createGain();
        popG.gain.setValueAtTime(0.048, now + 0.01);
        popG.gain.exponentialRampToValueAtTime(0.0006, now + 0.075);
        popSrc.connect(popBp);
        popBp.connect(popG);
        popG.connect(this.ctx.destination);
        popSrc.start(now + 0.01, Math.random() * 1.2, 0.075);
      } else {
        // Soft mechanical gear engagement thump on V6 / Taxi / SUV
        const thud = this.ctx.createOscillator();
        const tg = this.ctx.createGain();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(92, now);
        thud.frequency.exponentialRampToValueAtTime(44, now + 0.065);
        tg.gain.setValueAtTime(0.001, now);
        tg.gain.linearRampToValueAtTime(0.032, now + 0.006);
        tg.gain.exponentialRampToValueAtTime(0.0006, now + 0.072);
        thud.connect(tg);
        tg.connect(this.ctx.destination);
        thud.start(now);
        thud.stop(now + 0.08);
      }
    } else {
      // Downshift: crisp throttle rev-match blip!
      const isSporty =
        profile === 'exotic-v12' || profile === 'muscle-v8' || profile === 'flat6' || profile === 'turbo-jdm';
      const blip = this.ctx.createOscillator();
      const bFilt = this.ctx.createBiquadFilter();
      const bGain = this.ctx.createGain();
      blip.type = isSporty ? 'sawtooth' : 'triangle';
      const baseHz =
        profile === 'exotic-v12'
          ? 165
          : profile === 'flat6' || profile === 'turbo-jdm'
            ? 135
            : profile === 'muscle-v8'
              ? 88
              : 74;
      blip.frequency.setValueAtTime(baseHz, now);
      blip.frequency.exponentialRampToValueAtTime(baseHz * 1.62, now + 0.055);
      blip.frequency.exponentialRampToValueAtTime(baseHz * 1.12, now + 0.14);
      bFilt.type = 'lowpass';
      bFilt.frequency.value = isSporty ? 920 : 420;
      bGain.gain.setValueAtTime(0.001, now);
      bGain.gain.linearRampToValueAtTime(isSporty ? 0.048 : 0.025, now + 0.022);
      bGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.145);
      blip.connect(bFilt);
      bFilt.connect(bGain);
      bGain.connect(this.ctx.destination);
      blip.start(now);
      blip.stop(now + 0.155);
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
