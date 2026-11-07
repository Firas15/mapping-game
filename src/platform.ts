// Yandex Games SDK, kept behind a small wrapper. Outside Yandex (GitHub Pages,
// local dev) there is no SDK and every call quietly does nothing.

interface YaSdk {
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  environment: { i18n: { lang: string } };
  adv: {
    showFullscreenAdv(opts: { callbacks: { onOpen?(): void; onClose?(wasShown: boolean): void; onError?(e: unknown): void } }): void;
  };
  on(event: 'game_api_pause' | 'game_api_resume', cb: () => void): void;
}
declare global {
  interface Window { YaGames?: { init(): Promise<YaSdk> } }
}

let sdk: YaSdk | null = null;
let playing = false;
let pausedBySdk = false;
const pauseHandlers: ((paused: boolean) => void)[] = [];

/** Connects to the SDK if the page was opened on Yandex Games. Never throws. */
export async function initPlatform() {
  if (!window.YaGames) return;
  try {
    sdk = await window.YaGames.init();
    // the platform pauses us for ads, purchase windows and tab switches
    sdk.on('game_api_pause', () => { pausedBySdk = true; for (const h of pauseHandlers) h(true); });
    sdk.on('game_api_resume', () => { pausedBySdk = false; for (const h of pauseHandlers) h(false); });
  } catch {
    sdk = null;
  }
}

export const onYandex = () => !!sdk;
/** Player's language as the platform reports it ('ru', 'en', …). */
export const platformLang = () => sdk?.environment.i18n.lang ?? null;

/** Everything is loaded and the player can act. */
export function gameReady() { sdk?.features.LoadingAPI?.ready(); }

/** Tell the platform when real play starts and stops (menus, end screen…). */
export function gameplay(on: boolean) {
  if (on === playing) return;
  playing = on;
  if (on) sdk?.features.GameplayAPI?.start(); else sdk?.features.GameplayAPI?.stop();
}

/** Called with true when the game must go quiet (ads, tab hidden), false to come back. */
export function onPause(h: (paused: boolean) => void) { pauseHandlers.push(h); }
export const isPausedBySdk = () => pausedBySdk;

// fullscreen ads only at natural breaks, and not more often than this
const AD_GAP_MS = 3 * 60 * 1000;
let lastAd = Date.now();

/** Shows a fullscreen ad at a logical pause (new game, between turns). Resolves when it's over. */
export function breakAd(): Promise<void> {
  if (!sdk || Date.now() - lastAd < AD_GAP_MS) return Promise.resolve();
  lastAd = Date.now();
  const s = sdk;
  return new Promise((resolve) => {
    const wasPlaying = playing;
    gameplay(false);
    for (const h of pauseHandlers) h(true);
    const done = () => {
      for (const h of pauseHandlers) h(false);
      if (wasPlaying) gameplay(true);
      resolve();
    };
    try {
      s.adv.showFullscreenAdv({ callbacks: { onClose: done, onError: done } });
    } catch {
      done();
    }
  });
}
