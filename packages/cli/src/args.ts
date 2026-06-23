import { CliError } from './errors.js';

export interface ParsedArgs {
  command?: string;
  planPath?: string;
  out?: string;
  outDir?: string;
  help: boolean;
  version: boolean;
}

/**
 * Hand-rolled parse (same style as the per-package CLIs): the first non-flag
 * token is the command, the second is the plan path. Flags take the next token
 * as their value.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false, version: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--out': out.out = argv[++i]; break;
      case '--out-dir': out.outDir = argv[++i]; break;
      case '-h': case '--help': out.help = true; break;
      case '-v': case '--version': out.version = true; break;
      default:
        if (arg.startsWith('-')) throw new CliError(`unknown option: ${arg}`, 2);
        positionals.push(arg);
    }
  }
  out.command = positionals[0];
  out.planPath = positionals[1];
  return out;
}

/** Infer the output format from a file extension. */
export function outKind(outPath: string): 'svg' | 'png' | 'json' {
  const lower = outPath.toLowerCase();
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.json')) return 'json';
  throw new CliError(`unsupported --out extension: ${outPath} (use .svg, .png, or .json)`, 2);
}
