import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSynthesizer } from './audioSynthesizer';

function parameter() { return { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }; }
function oscillatorNode() { return { type: '', frequency: parameter(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }; }
function gainNode() { return { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() }; }
class Context {
  static instances: Context[] = [];
  state = 'suspended'; currentTime = 10; destination = {};
  oscillators: ReturnType<typeof oscillatorNode>[] = [];
  gains: ReturnType<typeof gainNode>[] = [];
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  constructor() { Context.instances.push(this); }
  createOscillator() {
    const oscillator = oscillatorNode();
    this.oscillators.push(oscillator); return oscillator;
  }
  createGain() {
    const gain = gainNode();
    this.gains.push(gain); return gain;
  }
}
beforeEach(() => { Context.instances = []; vi.stubGlobal('AudioContext', Context); });
afterEach(() => vi.unstubAllGlobals());
describe('asset-free audio cues', () => {
  it.each([['success', 'sine', [523.25, 659.25]], ['warning', 'triangle', [440, 329.63]]] as const)('synthesizes %s with envelope and natural disconnect', async (kind, shape, frequencies) => {
    const audio = new AudioSynthesizer(); expect(Context.instances).toHaveLength(0); await audio.play(kind);
    const context = Context.instances[0]; expect(context.resume).toHaveBeenCalledOnce();
    expect(context.oscillators).toHaveLength(2);
    context.oscillators.forEach((oscillator, i) => {
      expect(oscillator.type).toBe(shape); expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(frequencies[i], 10 + i * .16);
      expect(context.gains[i].gain.linearRampToValueAtTime).toHaveBeenCalledWith(.035, 10 + i * .16 + .025);
      expect(context.gains[i].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10 + i * .16 + .15);
      expect(oscillator.stop).toHaveBeenCalledWith(10 + i * .16 + .16);
      oscillator.onended!(); expect(oscillator.disconnect).toHaveBeenCalledOnce(); expect(context.gains[i].disconnect).toHaveBeenCalledOnce();
    });
    audio.dispose(); expect(context.close).toHaveBeenCalledOnce();
  });
  it('arms on gesture, reuses context, stops live nodes and recreates after disposal', async () => {
    const audio = new AudioSynthesizer(); await audio.unlock(); await audio.play('success');
    expect(Context.instances).toHaveLength(1); const context = Context.instances[0]; expect(context.resume).toHaveBeenCalledOnce();
    audio.dispose(); expect(context.oscillators.every(node => node.onended === null)).toBe(true);
    expect(context.oscillators[0].stop).toHaveBeenCalledTimes(2); expect(context.oscillators[0].disconnect).toHaveBeenCalledOnce();
    await audio.play('warning'); expect(Context.instances).toHaveLength(2); audio.dispose();
  });
  it('does not create nodes after pending resume is disposed', async () => {
    let resolve!: () => void;
    const audio = new AudioSynthesizer(); await audio.unlock(); const context = Context.instances[0]; context.state = 'suspended';
    context.resume.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const playing = audio.play('warning'); audio.dispose(); resolve(); await playing;
    expect(context.oscillators).toHaveLength(0); expect(context.close).toHaveBeenCalledOnce();
  });
  it('handles rejected resume and unsupported audio without unhandled rejection', async () => {
    const audio = new AudioSynthesizer(); await audio.unlock(); const context = Context.instances[0]; context.state = 'suspended';
    context.resume.mockRejectedValue(new Error('autoplay')); await expect(audio.play('warning')).resolves.toBeUndefined();
    expect(context.oscillators).toHaveLength(0); audio.dispose();
    vi.stubGlobal('AudioContext', undefined); await expect(new AudioSynthesizer().play('success')).resolves.toBeUndefined();
  });
});
