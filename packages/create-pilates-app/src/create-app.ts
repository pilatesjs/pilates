import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The bundled template directory, resolved relative to this module.
 * `src/create-app.ts` (under Vitest) and `dist/create-app.js` (once
 * published) both sit one level below the package root, beside
 * `template/` — so `../template` is correct from either.
 */
const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));

/** Template files whose `__PROJECT_NAME__` token is substituted. */
const SUBSTITUTED = new Set(['package.json', 'README.md']);

export interface CreateAppOptions {
  /** Directory to create the project in (created if absent). */
  targetDir: string;
  /** Project name — written into the generated package.json / README. */
  projectName: string;
}

/**
 * Scaffold a new Pilates app into `targetDir` from the bundled
 * template. Each template file is copied; a leading `_` in the name
 * becomes a `.` (so `_gitignore` lands as `.gitignore`), and the
 * `__PROJECT_NAME__` token is substituted in `package.json` /
 * `README.md`.
 *
 * Throws if `targetDir` already exists as a non-empty directory.
 */
export function createApp({ targetDir, projectName }: CreateAppOptions): void {
  const dest = resolve(targetDir);
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    throw new Error(`Target directory "${targetDir}" already exists and is not empty.`);
  }
  mkdirSync(dest, { recursive: true });

  for (const name of readdirSync(TEMPLATE_DIR)) {
    const destName = name.startsWith('_') ? `.${name.slice(1)}` : name;
    let content = readFileSync(join(TEMPLATE_DIR, name), 'utf8');
    if (SUBSTITUTED.has(destName)) {
      content = content.replaceAll('__PROJECT_NAME__', projectName);
    }
    writeFileSync(join(dest, destName), content);
  }
}
