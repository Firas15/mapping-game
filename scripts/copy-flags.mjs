// Copies the flags the game uses from flag-icons (MIT) into public/flags.
// Run: npm run build:flags
import fs from 'node:fs';

const codes = 'pt es fr gb ie be nl lu de ch at it dk no se fi is pl cz sk hu si hr ba rs me xk mk al gr bg ro md ua by lt lv ee ru tr cy'.split(' ');
fs.mkdirSync('public/flags', { recursive: true });
for (const c of codes) fs.copyFileSync(`node_modules/flag-icons/flags/4x3/${c}.svg`, `public/flags/${c}.svg`);
console.log(`copied ${codes.length} flags`);
