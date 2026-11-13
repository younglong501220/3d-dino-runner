export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private timeouts: number[] = [];

  public isEnabled(): boolean {
    return this.enabled;
  }

  public unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  private scheduleTone(delayMs: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timeouts = this.timeouts.filter((t) => t !== id);
      fn();
    }, delayMs);
    this.timeouts.push(id);
  }

  public playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType = 'square',
    volume = 0.08
  ): void {
    if (!this.enabled || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Ignore audio errors on restricted environments
    }
  }

  public jump(): void {
    this.playTone(260, 620, 0.14, 'square', 0.06);
  }

  public lane(): void {
    this.playTone(320, 440, 0.06, 'triangle', 0.05);
  }

  public duck(): void {
    this.playTone(240, 130, 0.09, 'triangle', 0.06);
  }

  public coin(): void {
    if (!this.enabled || !this.ctx) return;
    this.playTone(987.77, 987.77, 0.07, 'triangle', 0.09);
    this.scheduleTone(65, () => this.playTone(1318.51, 1318.51, 0.16, 'triangle', 0.09));
  }

  public speedUp(): void {
    if (!this.enabled || !this.ctx) return;
    this.playTone(440, 554.37, 0.08, 'sine', 0.07);
    this.scheduleTone(70, () => this.playTone(554.37, 659.25, 0.1, 'sine', 0.07));
    this.scheduleTone(140, () => this.playTone(659.25, 880, 0.14, 'sine', 0.07));
  }

  public milestone(): void {
    if (!this.enabled || !this.ctx) return;
    this.playTone(523.25, 523.25, 0.08, 'square', 0.05);
    this.scheduleTone(85, () => this.playTone(783.99, 783.99, 0.14, 'square', 0.05));
  }

  public crash(): void {
    this.playTone(180, 42, 0.35, 'sawtooth', 0.12);
    this.scheduleTone(50, () => this.playTone(110, 32, 0.28, 'square', 0.08));
  }

  public pause(): void {
    this.playTone(480, 320, 0.09, 'sine', 0.06);
  }

  public resume(): void {
    this.playTone(340, 560, 0.1, 'sine', 0.06);
  }

  public thunder(): void {
    if (!this.enabled || !this.ctx) return;
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const duration = 0.75;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.45));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220, now);
      filter.frequency.exponentialRampToValueAtTime(65, now + duration);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + duration);
    } catch {
      // Ignore audio errors on restricted environments
    }
  }

  public dispose(): void {
    for (const id of this.timeouts) {
      window.clearTimeout(id);
    }
    this.timeouts = [];
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
