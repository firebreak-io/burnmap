#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { archToSvg, archToPng } from '@burnmap/graph';
import { CliError } from './errors.js';
import { parseArgs } from './args.js';
import { runParse } from './commands/parse.js';
import { runArch } from './commands/arch.js';
import { ensureChromium } from './chromium.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const USAGE = `burnmap <command> <plan.json> [options]

Commands:
  parse   <plan.json> [--out model.json]     ChangeModel JSON (stdout if no --out)
  arch    <plan.json> --out <file.svg|.png>  architecture diagram
  plan    <plan.json> --out <file.png>       plan-diff diagram (needs Chromium)
  render  <plan.json> --out-dir <dir>        model.json + arch.svg + diff.png

Options:
  -h, --help       show this help
  -v, --version    print version
`;

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.version) { process.stdout.write(`${pkg.version}\n`); return; }
  if (args.help || !args.command) { process.stdout.write(USAGE); return; }

  switch (args.command) {
    case 'parse':
      runParse(args, {
        readFile: (p) => readFileSync(p, 'utf8'),
        writeFile: (p, d) => writeFileSync(p, d, 'utf8'),
        stdout: (s) => process.stdout.write(s),
        now: () => new Date().toISOString(),
      });
      return;
    case 'arch':
      await runArch(args, {
        readFile: (p) => readFileSync(p, 'utf8'),
        renderSvg: (plan, meta) => archToSvg(plan, meta),
        renderPng: (plan, meta, out) => archToPng(plan, meta, out),
        writeFile: (p, d) => writeFileSync(p, d, 'utf8'),
        stdout: (s) => process.stdout.write(s),
        ensureChromium: () => ensureChromium({
          executablePath: () => chromium.executablePath(),
          exists: existsSync,
        }),
        now: () => new Date().toISOString(),
      });
      return;
    default:
      throw new CliError(`unknown command: ${args.command}\n\n${USAGE}`, 2);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CliError) {
    process.stderr.write(`burnmap: ${err.message}\n`);
    process.exit(err.code);
  }
  process.stderr.write(`burnmap: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
