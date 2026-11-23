import type { EngineSoundProfile } from '../entities/vehicle';

export interface WaveguideEnginePreset {
  isElectric: boolean;
  cylinders: number;
  idleRpm: number;
  redlineRpm: number;
  /** Firing phase offsets in 0..1 across a full 720-degree 4-stroke cycle */
  firingOffsets: number[];
  /** Individual cylinder exhaust header runner lengths in meters */
  headerLengthsM: number[];
  /** Main exhaust pipe length from collector to muffler in meters */
  exhaustPipeM: number;
  /** 3 cascaded muffler expansion chamber lengths in meters */
  mufflerChambersM: [number, number, number];
  /** Exhaust damping lowpass cutoff (Hz) — lower = deeper/more muffled, higher = rawer exotic bark */
  mufflerDampHz: number;
  /** Intake plenum pipe length in meters */
  intakePipeM: number;
  /** Relative mix weights */
  exhaustMix: number;
  intakeMix: number;
  blockMix: number;
  /** Idle cam-lope RPM irregularity (higher on V8s for authentic blub-blub idle!) */
  idleLope: number;
  /** Overrun crackle/pop probability on throttle lift & downshift */
  crackleAmt: number;
  /** Exhaust nonlinearity drive */
  drive: number;
  /** Output trim */
  masterGain: number;
}

export const WAVEGUIDE_ENGINE_PRESETS: Record<EngineSoundProfile, WaveguideEnginePreset> = {
  // Italian V12 Exotic (Solstice GT / Ferrari): 12 evenly spaced cylinders, short screaming headers, 9,000 RPM!
  'exotic-v12': {
    isElectric: false,
    cylinders: 12,
    idleRpm: 1050,
    redlineRpm: 9000,
    firingOffsets: [0, 1 / 12, 2 / 12, 3 / 12, 4 / 12, 5 / 12, 6 / 12, 7 / 12, 8 / 12, 9 / 12, 10 / 12, 11 / 12],
    headerLengthsM: [0.54, 0.56, 0.55, 0.57, 0.54, 0.56, 0.55, 0.57, 0.54, 0.56, 0.55, 0.57],
    exhaustPipeM: 1.55,
    mufflerChambersM: [0.16, 0.24, 0.34],
    mufflerDampHz: 2350,
    intakePipeM: 0.34,
    exhaustMix: 0.92,
    intakeMix: 0.52,
    blockMix: 0.14,
    idleLope: 18,
    crackleAmt: 0.55,
    drive: 1.75,
    masterGain: 0.56,
  },
  // Twin-Turbo Cross-Plane V8 (Neon Apex / Street GT): TRUE uneven cross-plane bank firing + unequal headers!
  'muscle-v8': {
    isElectric: false,
    cylinders: 8,
    idleRpm: 720,
    redlineRpm: 6800,
    // Cross-plane V8 uneven bank pulses create the unmistakable deep throaty burble!
    firingOffsets: [0, 90 / 720, 180 / 720, 270 / 720, 360 / 720, 450 / 720, 540 / 720, 630 / 720],
    headerLengthsM: [0.64, 0.92, 0.72, 0.98, 0.68, 0.88, 0.76, 0.94],
    exhaustPipeM: 2.35,
    mufflerChambersM: [0.24, 0.37, 0.52],
    mufflerDampHz: 1180,
    intakePipeM: 0.44,
    exhaustMix: 1.05,
    intakeMix: 0.44,
    blockMix: 0.2,
    idleLope: 54,
    crackleAmt: 0.72,
    drive: 1.95,
    masterGain: 0.62,
  },
  // Flat-6 Boxer Roadster (Key Sol Spyder): metallic raspy unequal boxer headers, 8,200 RPM!
  flat6: {
    isElectric: false,
    cylinders: 6,
    idleRpm: 900,
    redlineRpm: 8200,
    firingOffsets: [0, 120 / 720, 240 / 720, 360 / 720, 480 / 720, 600 / 720],
    headerLengthsM: [0.58, 0.76, 0.62, 0.8, 0.6, 0.78],
    exhaustPipeM: 1.72,
    mufflerChambersM: [0.19, 0.28, 0.4],
    mufflerDampHz: 1950,
    intakePipeM: 0.36,
    exhaustMix: 0.95,
    intakeMix: 0.58,
    blockMix: 0.16,
    idleLope: 26,
    crackleAmt: 0.6,
    drive: 1.8,
    masterGain: 0.56,
  },
  // Tuned Turbo Inline-6 / Drift Coupe (Biscayne JDM): tight turbo headers, punchy 8,000 RPM pull!
  'turbo-jdm': {
    isElectric: false,
    cylinders: 6,
    idleRpm: 880,
    redlineRpm: 7900,
    firingOffsets: [0, 120 / 720, 240 / 720, 360 / 720, 480 / 720, 600 / 720],
    headerLengthsM: [0.5, 0.54, 0.58, 0.62, 0.55, 0.59],
    exhaustPipeM: 1.9,
    mufflerChambersM: [0.18, 0.27, 0.36],
    mufflerDampHz: 1750,
    intakePipeM: 0.32,
    exhaustMix: 0.92,
    intakeMix: 0.62,
    blockMix: 0.14,
    idleLope: 24,
    crackleAmt: 0.65,
    drive: 1.85,
    masterGain: 0.56,
  },
  // Grand Touring V6 Coupe (Wynwood GT Coupe): refined smooth V6 exhaust + balanced intake
  'sport-v6': {
    isElectric: false,
    cylinders: 6,
    idleRpm: 780,
    redlineRpm: 7100,
    firingOffsets: [0, 120 / 720, 240 / 720, 360 / 720, 480 / 720, 600 / 720],
    headerLengthsM: [0.68, 0.72, 0.74, 0.7, 0.76, 0.73],
    exhaustPipeM: 2.15,
    mufflerChambersM: [0.22, 0.34, 0.46],
    mufflerDampHz: 1380,
    intakePipeM: 0.42,
    exhaustMix: 0.88,
    intakeMix: 0.42,
    blockMix: 0.14,
    idleLope: 18,
    crackleAmt: 0.28,
    drive: 1.6,
    masterGain: 0.52,
  },
  // Dual-Motor Electric Sedan (Biscayne EV / Metro EV): refined quiet electric drive + helical gear whisper
  'electric-ev': {
    isElectric: true,
    cylinders: 0,
    idleRpm: 0,
    redlineRpm: 14000,
    firingOffsets: [],
    headerLengthsM: [],
    exhaustPipeM: 1.0,
    mufflerChambersM: [0.2, 0.3, 0.4],
    mufflerDampHz: 1800,
    intakePipeM: 0.3,
    exhaustMix: 0,
    intakeMix: 0,
    blockMix: 0,
    idleLope: 0,
    crackleAmt: 0,
    drive: 1.0,
    masterGain: 0.095,
  },
  // Everyday City Cruiser Sedan (Sol City Taxi): 4-cylinder quiet muffled commuter engine
  'commuter-i4': {
    isElectric: false,
    cylinders: 4,
    idleRpm: 760,
    redlineRpm: 5800,
    firingOffsets: [0, 0.25, 0.5, 0.75],
    headerLengthsM: [0.78, 0.84, 0.82, 0.88],
    exhaustPipeM: 2.45,
    mufflerChambersM: [0.26, 0.39, 0.54],
    mufflerDampHz: 880,
    intakePipeM: 0.48,
    exhaustMix: 0.8,
    intakeMix: 0.32,
    blockMix: 0.18,
    idleLope: 16,
    crackleAmt: 0.06,
    drive: 1.45,
    masterGain: 0.48,
  },
  // Heavy Luxury SUV V8 (Coral Cruiser SUV): long deep exhaust pipes, bassy low-end V8 rumble!
  'heavy-v8': {
    isElectric: false,
    cylinders: 8,
    idleRpm: 620,
    redlineRpm: 5500,
    firingOffsets: [0, 90 / 720, 180 / 720, 270 / 720, 360 / 720, 450 / 720, 540 / 720, 630 / 720],
    headerLengthsM: [0.86, 1.12, 0.92, 1.18, 0.88, 1.1, 0.94, 1.16],
    exhaustPipeM: 2.85,
    mufflerChambersM: [0.3, 0.45, 0.62],
    mufflerDampHz: 740,
    intakePipeM: 0.52,
    exhaustMix: 1.0,
    intakeMix: 0.3,
    blockMix: 0.22,
    idleLope: 36,
    crackleAmt: 0.14,
    drive: 1.75,
    masterGain: 0.62,
  },
};

/**
 * Self-contained real-time 48kHz AudioWorkletProcessor implementing physical digital-waveguide
 * internal combustion engine synthesis (inspired by Baldan et al. & DasEtwas/enginesound):
 * - Individual cylinder 4-stroke combustion & intake-valve pressure impulses with cycle-to-cycle turbulence
 * - Per-cylinder bidirectional exhaust header waveguides reflecting at the collector junction
 * - Collector -> straight exhaust pipe waveguide -> 3 cascaded damped muffler chambers
 * - Resonant intake plenum waveguide opening dynamically with throttle load
 * - Physical exhaust overrun crackles/pops injected directly into the collector pipe!
 */
export const ENGINE_WORKLET_CODE = /* js */ `
class DelayPipe {
  constructor(maxSamples) {
    this.buf = new Float32Array(maxSamples);
    this.mask = maxSamples - 1;
    this.idx = 0;
    this.len = 32;
    this.lp = 0;
  }
  setLength(samples) {
    this.len = Math.max(4, Math.min(this.buf.length - 2, Math.round(samples)));
  }
  clear() {
    this.buf.fill(0);
    this.lp = 0;
  }
  read() {
    return this.buf[(this.idx - this.len) & this.mask];
  }
  step(input, dampAlpha) {
    const out = this.buf[(this.idx - this.len) & this.mask];
    this.lp += dampAlpha * (input - this.lp);
    this.buf[this.idx] = this.lp;
    this.idx = (this.idx + 1) & this.mask;
    return out;
  }
}

class PhysicalEngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpmNorm', defaultValue: 0.14, minValue: 0.0, maxValue: 1.2, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'active', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'shiftCut', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.speedOfSound = 343.0;
    this.crank = 0.0;
    this.smoothRpm = 850.0;
    this.smoothThrottle = 0.0;
    this.smoothActive = 0.0;
    this.smoothShift = 0.0;
    this.prevThrottle = 0.0;
    this.overrunTimer = 0.0;
    this.shiftPopImpulse = 0.0;
    this.evPhaseA = 0.0;
    this.evPhaseB = 0.0;
    this.lopePhase = 0.0;

    // Fast xorshift32 PRNG (zero allocations on audio thread)
    this.rngState = 0x2f6e2b1;
    this.pink0 = 0;
    this.pink1 = 0;
    this.pink2 = 0;
    this.dcX = 0;
    this.dcY = 0;
    this.outLp = 0;

    // Pre-allocate up to 12 bidirectional cylinder exhaust runner pipes + intake + collector + 3 muffler chambers
    this.headersFwd = [];
    this.headersBwd = [];
    this.cylJitter = new Float32Array(12);
    this.cylPrevPhase = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      this.headersFwd.push(new DelayPipe(512));
      this.headersBwd.push(new DelayPipe(512));
      this.cylJitter[i] = 1.0;
      this.cylPrevPhase[i] = 0.0;
    }
    this.intakePipe = new DelayPipe(512);
    this.exhaustPipeFwd = new DelayPipe(1024);
    this.exhaustPipeBwd = new DelayPipe(1024);
    this.muf1 = new DelayPipe(512);
    this.muf2 = new DelayPipe(512);
    this.muf3 = new DelayPipe(512);

    this.preset = {
      isElectric: false,
      cylinders: 8,
      idleRpm: 750,
      redlineRpm: 7200,
      firingOffsets: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
      headerLengthsM: [0.65, 0.9, 0.7, 0.95, 0.68, 0.88, 0.74, 0.92],
      exhaustPipeM: 2.2,
      mufflerChambersM: [0.22, 0.34, 0.48],
      mufflerDampHz: 1300,
      intakePipeM: 0.42,
      exhaustMix: 0.95,
      intakeMix: 0.45,
      blockMix: 0.18,
      idleLope: 30,
      crackleAmt: 0.5,
      drive: 1.55,
      masterGain: 0.35,
    };
    this.applyPreset(this.preset);

    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'preset' && msg.preset) {
        this.applyPreset(msg.preset);
      } else if (msg.type === 'shift') {
        if (msg.kind === 'up') {
          this.shiftPopImpulse = 0.75 * (this.preset.crackleAmt || 0.3);
        } else if (msg.kind === 'down') {
          this.overrunTimer = Math.max(this.overrunTimer, 0.35);
          this.shiftPopImpulse = 0.55 * (this.preset.crackleAmt || 0.3);
        }
      }
    };
  }

  nextRand() {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState / 4294967296) * 2.0 - 1.0;
  }

  nextPink() {
    const w = this.nextRand();
    this.pink0 = 0.99765 * this.pink0 + w * 0.099046;
    this.pink1 = 0.963 * this.pink1 + w * 0.2965164;
    this.pink2 = 0.57 * this.pink2 + w * 1.0526913;
    return (this.pink0 + this.pink1 + this.pink2 + w * 0.1848) * 0.2;
  }

  applyPreset(p) {
    this.preset = p;
    const toSamples = (meters) => (meters / this.speedOfSound) * this.sr;
    for (let i = 0; i < 12; i++) {
      const hm = p.headerLengthsM[i] || 0.7;
      this.headersFwd[i].setLength(toSamples(hm));
      this.headersBwd[i].setLength(toSamples(hm));
      this.headersFwd[i].clear();
      this.headersBwd[i].clear();
    }
    this.intakePipe.setLength(toSamples(p.intakePipeM || 0.4));
    this.intakePipe.clear();
    this.exhaustPipeFwd.setLength(toSamples(p.exhaustPipeM || 2.0));
    this.exhaustPipeBwd.setLength(toSamples(p.exhaustPipeM || 2.0));
    this.exhaustPipeFwd.clear();
    this.exhaustPipeBwd.clear();
    const mc = p.mufflerChambersM || [0.22, 0.34, 0.48];
    this.muf1.setLength(toSamples(mc[0]));
    this.muf2.setLength(toSamples(mc[1]));
    this.muf3.setLength(toSamples(mc[2]));
    this.muf1.clear();
    this.muf2.clear();
    this.muf3.clear();
  }

  process(_inputs, outputs, parameters) {
    const out = outputs[0][0];
    if (!out) return true;

    const targetRpmNorm = parameters.rpmNorm[0];
    const targetThrottle = parameters.throttle[0];
    const targetActive = parameters.active[0];
    const targetShift = parameters.shiftCut[0];

    const p = this.preset;
    const targetRpm = p.idleRpm + (p.redlineRpm - p.idleRpm) * Math.max(0, Math.min(1.08, targetRpmNorm));

    // Detect sharp throttle lift at high RPM for realistic exhaust overrun burbles!
    if (this.prevThrottle - targetThrottle > 0.35 && targetRpmNorm > 0.45 && !p.isElectric) {
      this.overrunTimer = Math.max(this.overrunTimer, 0.45);
    }
    this.prevThrottle = targetThrottle;

    const dampHz = p.mufflerDampHz * (0.62 + this.smoothThrottle * 0.45 + targetRpmNorm * 0.35);
    const dampAlpha = Math.min(0.88, (2 * Math.PI * dampHz) / (2 * Math.PI * dampHz + this.sr));
    const headerAlpha = Math.min(0.92, (2 * Math.PI * (dampHz * 1.45)) / (2 * Math.PI * (dampHz * 1.45) + this.sr));
    const cylCount = p.cylinders | 0;
    const invCyl = cylCount > 0 ? 1.0 / Math.sqrt(cylCount) : 1.0;

    for (let s = 0; s < out.length; s++) {
      this.smoothActive += 0.0025 * (targetActive - this.smoothActive);
      if (this.smoothActive < 0.0004) {
        out[s] = 0;
        continue;
      }

      this.smoothRpm += 0.0018 * (targetRpm - this.smoothRpm);
      this.smoothThrottle += 0.0025 * (targetThrottle - this.smoothThrottle);
      this.smoothShift += 0.006 * (targetShift - this.smoothShift);

      if (p.isElectric) {
        // Refined silent-at-idle dual-motor electric drive + subtle helical reduction gear texture
        const norm = Math.max(0, (this.smoothRpm - 200) / p.redlineRpm);
        const fA = 95 + norm * 420;
        const fB = fA * 1.5;
        this.evPhaseA = (this.evPhaseA + fA / this.sr) % 1.0;
        this.evPhaseB = (this.evPhaseB + fB / this.sr) % 1.0;
        const motor =
          Math.sin(this.evPhaseA * 6.2831853) * 0.55 +
          Math.sin(this.evPhaseB * 6.2831853) * 0.22 +
          this.nextPink() * 0.14 * norm;
        const amp = Math.min(1, norm * 1.25) * (0.45 + this.smoothThrottle * 0.55) * p.masterGain * this.smoothActive;
        out[s] = motor * amp;
        continue;
      }

      // Organic idle cam-lope RPM flutter (strongest at idle on V8s, smooths out under revs!)
      const idleFactor = Math.max(0, 1.0 - targetRpmNorm * 2.6);
      this.lopePhase = (this.lopePhase + 4.8 / this.sr) % 1.0;
      const lope = (Math.sin(this.lopePhase * 6.2831853) + 0.5 * Math.sin(this.lopePhase * 16.4)) * p.idleLope * idleFactor;
      const instRpm = Math.max(320, this.smoothRpm + lope);

      // Advance 720-degree 4-stroke crank cycle (2 revolutions per full cycle => RPM / 120 Hz)
      const cycleFreq = instRpm / 120.0;
      this.crank += cycleFreq / this.sr;
      if (this.crank >= 1.0) this.crank -= 1.0;

      const pink = this.nextPink();
      const white = this.nextRand();
      const ignPower = (0.34 + this.smoothThrottle * 0.78) * (1.0 - this.smoothShift * 0.65);

      let collectorIn = 0.0;
      let intakeIn = 0.0;
      let blockMech = 0.0;

      for (let c = 0; c < cylCount; c++) {
        let ph = this.crank + p.firingOffsets[c];
        if (ph >= 1.0) ph -= 1.0;

        // Refresh natural per-cylinder cycle-to-cycle combustion jitter once per 720-deg cycle
        if (ph < this.cylPrevPhase[c]) {
          this.cylJitter[c] = 0.84 + (this.nextRand() * 0.5 + 0.5) * 0.32;
        }
        this.cylPrevPhase[c] = ph;

        const jit = this.cylJitter[c];

        // 1. Power/Exhaust blowdown pulse (sharp physical gas expansion + turbulent flame front!)
        let cylExhaust = 0.0;
        if (ph < 0.18) {
          const u = ph / 0.18;
          // Fast-attack asymmetric combustion blowdown wave (realistic rounded impulse, never sawtooth!)
          const pulse = Math.sin(u * Math.PI) * Math.exp(-u * 2.4);
          const turb = pink * 0.42 + white * 0.12;
          cylExhaust = (pulse * (1.15 + turb) * ignPower * jit);
          blockMech += pulse * 0.35 * jit;
        } else if (ph < 0.42) {
          // Exhaust scavenging rush while exhaust valve closes
          const u = (ph - 0.18) / 0.24;
          const valve = Math.sin(u * Math.PI);
          cylExhaust = valve * pink * 0.26 * (0.35 + this.smoothThrottle * 0.65);
        }

        // 2. Intake stroke (0.48..0.78): pulls throaty turbulent induction air through intake plenum!
        if (ph >= 0.48 && ph < 0.78) {
          const u = (ph - 0.48) / 0.3;
          const valve = Math.sin(u * Math.PI);
          intakeIn += valve * (0.28 + pink * 0.72) * (0.14 + this.smoothThrottle * 0.86) * jit;
        }

        // 3. Bidirectional steel header runner waveguide (waves bounce between closed valve & collector!)
        const bwdWave = this.headersBwd[c].read();
        const fwdOut = this.headersFwd[c].step(cylExhaust + bwdWave * 0.48, headerAlpha);
        this.headersBwd[c].step(fwdOut * -0.34, headerAlpha);
        collectorIn += fwdOut;
      }

      collectorIn *= invCyl;
      intakeIn *= invCyl;
      blockMech *= invCyl;

      // Exhaust overrun burbles/pops injected directly into the hot collector pipe!
      if (this.overrunTimer > 0) {
        this.overrunTimer -= 1.0 / this.sr;
        if (p.crackleAmt > 0.05 && Math.abs(white) > 0.9985 - p.crackleAmt * 0.0018) {
          this.shiftPopImpulse = Math.max(this.shiftPopImpulse, 0.65 * p.crackleAmt);
        }
      }
      if (this.shiftPopImpulse > 0.001) {
        collectorIn += (pink * 1.4 + 0.5) * this.shiftPopImpulse;
        this.shiftPopImpulse *= 0.9945;
      }

      // Collector -> Straight Exhaust Pipe Bidirectional Waveguide
      const exBwd = this.exhaustPipeBwd.read();
      const exPipeOut = this.exhaustPipeFwd.step(collectorIn + exBwd * 0.46, dampAlpha);
      this.exhaustPipeBwd.step(exPipeOut * -0.52, dampAlpha);

      // 3-Chamber Reflective Baffle Muffler (physically shapes warm deep acoustic exhaust tone!)
      const m1Out = this.muf1.step(exPipeOut + this.muf2.read() * 0.28, dampAlpha);
      const m2Out = this.muf2.step(m1Out * 0.78 + this.muf3.read() * 0.25, dampAlpha * 0.85);
      const m3Out = this.muf3.step(m2Out * 0.76, dampAlpha * 0.72);
      const exhaustFinal = m1Out * 0.22 + m2Out * 0.38 + m3Out * 0.58;

      // Resonant Intake Plenum Waveguide
      const intakeOut = this.intakePipe.step(intakeIn + this.intakePipe.read() * -0.42, headerAlpha * 0.85);

      // Mix Exhaust + Intake Induction + Crankcase Mechanical Rumble -> Soft Analog Saturation
      let sig = exhaustFinal * p.exhaustMix + intakeOut * p.intakeMix + blockMech * p.blockMix;
      sig = Math.tanh(sig * p.drive);

      // Gentle 1-pole DC blocker + warm final air rolloff (kills any harsh digital aliasing)
      const dcOut = sig - this.dcX + 0.995 * this.dcY;
      this.dcX = sig;
      this.dcY = dcOut;
      this.outLp += 0.42 * (dcOut - this.outLp);

      out[s] = this.outLp * p.masterGain * this.smoothActive;
    }
    return true;
  }
}

registerProcessor('physical-engine-processor', PhysicalEngineProcessor);
`;
