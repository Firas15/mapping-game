import './style.css';
import './ui/game.css';
import './ui/menu.css';
import { europe } from './data/map';
import { App } from './ui/app';

const app = new App(europe);
const splash = document.getElementById('splash');
if (splash) {
  splash.classList.add('gone');
  setTimeout(() => splash.remove(), 500);
}
// handy in the browser console while developing; not in production builds
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
