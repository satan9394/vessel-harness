/** Native, quiet two-note cues; no downloaded audio or context created on mount. */
export class AudioSynthesizer {
  private context?: AudioContext;
  private nodes = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  private generation = 0;

  /** Arm audio in the submit/unmute user gesture, before async task completion. */
  async unlock(): Promise<void> {
    try {
      if (typeof AudioContext === 'undefined') return;
      const context = this.context ??= new AudioContext();
      if (context.state === 'suspended') await context.resume();
    } catch { /* autoplay/device policy */ }
  }

  async play(kind: 'success' | 'warning'): Promise<void> {
    const generation = this.generation;
    try {
      if (typeof AudioContext === 'undefined') return;
      const context = this.context ??= new AudioContext();
      if (context.state === 'suspended') await context.resume();
      if (generation !== this.generation || context.state !== 'running') return;
      const notes = kind === 'success' ? [523.25, 659.25] : [440, 329.63];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const node = { oscillator, gain };
        this.nodes.add(node);
        const start = context.currentTime + index * 0.16;
        oscillator.type = kind === 'success' ? 'sine' : 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.035, start + 0.025);
        gain.gain.linearRampToValueAtTime(0, start + 0.15);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.nodes.delete(node); };
        oscillator.start(start);
        oscillator.stop(start + 0.16);
      });
    } catch {
      // Browser autoplay or device policy can reject a cue; attention still has a title.
    }
  }

  dispose(): void {
    this.generation += 1;
    for (const { oscillator, gain } of this.nodes) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* already ended */ }
      oscillator.disconnect(); gain.disconnect();
    }
    this.nodes.clear();
    const context = this.context;
    this.context = undefined;
    if (context) void context.close().catch(() => undefined);
  }
}
