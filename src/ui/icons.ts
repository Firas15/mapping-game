import {
  createElement, Coins, Swords, Megaphone, Factory, Shield, PartyPopper, Handshake, Users, Bird, Landmark,
  Castle, Flag, Vote, Smile, CircleHelp, RotateCcw, ZoomIn, ZoomOut, Crosshair, X, ChevronRight, Trophy,
  Hourglass, Sparkles, type IconNode,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  coins: Coins, swords: Swords, megaphone: Megaphone, factory: Factory, shield: Shield, party: PartyPopper,
  handshake: Handshake, users: Users, dove: Bird, bank: Landmark, castle: Castle, flag: Flag, ballot: Vote,
  smile: Smile, help: CircleHelp, restart: RotateCcw, zoomIn: ZoomIn, zoomOut: ZoomOut, target: Crosshair,
  close: X, next: ChevronRight, trophy: Trophy, hourglass: Hourglass, sparkles: Sparkles,
};

export function icon(name: string, size = 18): string {
  const el = createElement(ICONS[name] ?? Flag);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  return el.outerHTML;
}
