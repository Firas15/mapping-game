import '@fontsource-variable/manrope';
import '@fontsource-variable/unbounded';
import './style.css';
import './ui/game.css';
import './ui/menu.css';
import { europe } from './data/map';
import { App } from './ui/app';
import { gameReady, initPlatform, onPause } from './platform';
import { setQuiet } from './ui/sound';

// no browser menu or text selection on the game field (long tap on phones included)
document.addEventListener('contextmenu', (e) => e.preventDefault());

await initPlatform();
// ads and other platform pauses silence the game
onPause((paused) => setQuiet('platform', paused));

const app = new App(europe);
const splash = document.getElementById('splash');
if (splash) {
  splash.classList.add('gone');
  setTimeout(() => splash.remove(), 500);
}
gameReady();
// handy in the browser console while developing; not in production builds
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
