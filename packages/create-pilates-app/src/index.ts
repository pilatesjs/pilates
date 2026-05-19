#!/usr/bin/env node
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createApp } from './create-app.js';

const USAGE = 'Usage: npm create pilates-app [directory]';

async function promptForDir(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Project directory: (pilates-app) ')).trim();
    return answer.length > 0 ? answer : 'pilates-app';
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const positional = args.find((a) => !a.startsWith('-'));
  const targetDir = positional ?? (await promptForDir());
  const projectName = basename(resolve(targetDir));

  createApp({ targetDir, projectName });

  console.log(`\nScaffolded ${projectName} in ${targetDir}\n`);
  console.log('Next steps:');
  console.log(`  cd ${targetDir}`);
  console.log('  npm install');
  console.log('  npm run dev\n');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
