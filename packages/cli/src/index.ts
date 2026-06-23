#!/usr/bin/env node
import { createRequire } from 'node:module';
import { CliError } from './errors.js';

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
  // Dispatch is added in later tasks. For now only global flags are handled.
  if (argv.includes('-v') || argv.includes('--version')) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  throw new CliError(`unknown command: ${argv[0]}\n\n${USAGE}`, 2);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CliError) {
    process.stderr.write(`burnmap: ${err.message}\n`);
    process.exit(err.code);
  }
  process.stderr.write(`burnmap: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
