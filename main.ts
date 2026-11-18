import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = resolve(
  process.env.MAKEFUN_BOT_DIR || dirname(fileURLToPath(import.meta.url)),
);
const output = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
const dossierPath = join(output, 'dossier.json');

await mkdir(output, { recursive: true });
await cp(join(root, 'game'), join(output, 'game'), { recursive: true });
await cp(join(root, 'screenshots'), join(output, 'screenshots'), { recursive: true });

const dossier = buildDossier(output, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});

await writeFile(dossierPath, dossier);
console.log(`Wrote dossier: ${dossierPath}`);
