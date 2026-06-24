/** An error carrying the process exit code the CLI should terminate with. */
export class CliError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = 'CliError';
  }
}
