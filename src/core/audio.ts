import { clamp } from './math';

/**
 * Lightweight Web Audio synthesizer for car engine note, tire drift hiss,
 * car horn, and UI/mission feedback chimes. Lazily unlocks on first gesture.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private driftGain: GainNode | null = null;
  private hornOscA: OscillatorNode | null = null;
  private hornOscB: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;
  public enabled = true;

  public unlock(): void {
    if (this.ctx || typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    // Engine main + sub harmonic
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 64;

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = 32;

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(ctx.destination);
    osc.start();
    sub.start();

    this.engineOsc = osc;
    this.engineSub = sub;
    this.engineGain = engineGain;

    // Filtered noise for tire drift screech
    const bufLen = ctx.sampleRate * 1.5;
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1350;
    bandpass.Q.value = 4.2;

    const driftGain = ctx.createGain();
    driftGain.gain.value = 0;

    noiseSrc.connect(bandpass);
    bandpass.connect(driftGain);
    driftGain.connect(ctx.destination);
    noiseSrc.start();
    this.driftGain = driftGain;

    // Dual-tone modern car horn
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
    this.driftGain?.gain.setTargetAtTime(0, now, 0.04);
    this.hornGain?.gain.setTargetAtTime(0, now, 0.03);
  }

  public updateDriving(
    inCar: boolean,
    speedNorm: number,
    throttle: number,
    driftAmount: number,
    horn: boolean,
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
      this.silenceContinuous();
      return;
    }

    const rpm = clamp(0.18 + speedNorm * 0.72 + Math.abs(throttle) * 0.16, 0.15, 1.1);
    const baseFreq = 46 + rpm * 150;
    this.engineOsc?.frequency.setTargetAtTime(baseFreq, now, 0.04);
    this.engineSub?.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.04);
    this.engineGain?.gain.setTargetAtTime(0.025 + Math.abs(throttle) * 0.03 + speedNorm * 0.02, now, 0.06);

    const driftVol = clamp(driftAmount * 0.075, 0, 0.075);
    this.driftGain?.gain.setTargetAtTime(driftVol, now, 0.04);

    this.hornGain?.gain.setTargetAtTime(horn ? 0.065 : 0, now, 0.02);
    void this.hornOscA;
    void this.hornOscB;
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
}
