// Game sounds, made on the fly with Web Audio: no files to load.

export type Sfx =
  | 'click' | 'select' | 'recruit' | 'card' | 'win' | 'loss' | 'capital' | 'turn'
  | 'event' | 'alarm' | 'buy' | 'ally' | 'victory' | 'defeat';

const MUTE_KEY = 'mapping-muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
})();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = m ? 0 : 0.5;
}

/** Browsers only allow sound after a click, so the context starts lazily. */
function audio(): { ac: AudioContext; out: GainNode } | null {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { ac: ctx, out: master! };
  } catch {
    return null;
  }
}

/** One note with a quick attack and an exponential fade. */
function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const t = a.ac.currentTime + start;
  const osc = a.ac.createOscillator();
  const g = a.ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Filtered noise: drums, paper, wind. */
function noise(start: number, dur: number, vol = 0.25, freq = 1200, q = 0.8) {
  const a = audio();
  if (!a) return;
  const t = a.ac.currentTime + start;
  const len = Math.ceil(a.ac.sampleRate * dur);
  const buf = a.ac.createBuffer(1, len, a.ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = a.ac.createBufferSource();
  src.buffer = buf;
  const f = a.ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.out);
  src.start(t);
}

const drum = (start: number, vol = 0.4) => {
  tone(120, start, 0.18, 'sine', vol, 50);
  noise(start, 0.08, vol * 0.5, 900, 1.2);
};

const SOUNDS: Record<Sfx, () => void> = {
  click: () => tone(880, 0, 0.05, 'triangle', 0.12),
  select: () => { tone(520, 0, 0.07, 'triangle', 0.12); tone(780, 0.04, 0.08, 'triangle', 0.1); },
  recruit: () => { drum(0, 0.3); drum(0.12, 0.25); drum(0.24, 0.32); },
  card: () => { noise(0, 0.14, 0.18, 3000, 0.6); tone(660, 0.05, 0.12, 'triangle', 0.12); },
  buy: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.06, 0.25, 'triangle', 0.16)),
  win: () => {
    drum(0, 0.45);
    noise(0, 0.25, 0.2, 400, 0.7);
    [392, 523, 659].forEach((f, i) => tone(f, 0.12 + i * 0.09, 0.35, 'sawtooth', 0.08));
  },
  loss: () => {
    drum(0, 0.45);
    tone(220, 0.08, 0.5, 'sawtooth', 0.1, 110);
    tone(165, 0.2, 0.55, 'sine', 0.15, 82);
  },
  capital: () => {
    drum(0, 0.4); drum(0.15, 0.4);
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25 + i * 0.12, 0.5, 'square', 0.07));
  },
  turn: () => { tone(392, 0, 0.9, 'sine', 0.18); tone(588, 0, 0.9, 'sine', 0.08); tone(784, 0.02, 0.7, 'sine', 0.05); },
  event: () => { tone(660, 0, 0.18, 'triangle', 0.16); tone(880, 0.14, 0.3, 'triangle', 0.16); },
  alarm: () => [0, 0.22, 0.44].forEach((t) => tone(740, t, 0.16, 'square', 0.08, 560)),
  ally: () => [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.08, 0.4, 'sine', 0.14)),
  victory: () => {
    [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.35, 'square', 0.07));
    for (let i = 0; i < 6; i++) drum(i * 0.28, 0.3);
  },
  defeat: () => [392, 370, 349, 262].forEach((f, i) => tone(f, i * 0.35, 0.6, 'sawtooth', 0.08)),
};

export function play(name: Sfx) {
  if (muted) return;
  try { SOUNDS[name](); } catch { /* sound is never worth breaking the game */ }
}
