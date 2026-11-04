import './style.css';
import './ui/game.css';
import europe from './data/europe.json';
import { App } from './ui/app';

const app = new App(europe);
// handy in the browser console while developing; not in production builds
if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
