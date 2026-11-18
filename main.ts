import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const sourceRoot = process.env.MAKEFUN_BOT_DIR || dirname(fileURLToPath(import.meta.url));
const outputRoot = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const dossierPath = join(outputRoot, 'dossier.json');

await mkdir(outputRoot, { recursive: true });
await cp(join(sourceRoot, 'game'), join(outputRoot, 'game'), { recursive: true });
await cp(join(sourceRoot, 'screenshots'), join(outputRoot, 'screenshots'), { recursive: true });

const dossier = buildDossier(outputRoot, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});

await writeFile(dossierPath, dossier);
console.log(`Wrote dossier: ${dossierPath}`);
