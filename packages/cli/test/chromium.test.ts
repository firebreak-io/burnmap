import { describe, it, expect } from 'vitest';
import { ensureChromium } from '../src/chromium.js';
import { CliError } from '../src/errors.js';

describe('ensureChromium', () => {
  it('passes when the browser binary exists', () => {
    expect(() => ensureChromium({
      executablePath: () => '/browsers/chromium/chrome',
      exists: () => true,
    })).not.toThrow();
  });

  it('throws CliError(3) with the install hint when the binary is missing', () => {
    try {
      ensureChromium({ executablePath: () => '/browsers/chromium/chrome', exists: () => false });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe(3);
      expect((e as CliError).message).toContain('npx playwright install chromium');
    }
  });

  it('throws CliError(3) when executablePath itself throws (no browsers registered)', () => {
    try {
      ensureChromium({
        executablePath: () => { throw new Error('Executable doesn\'t exist'); },
        exists: () => true,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe(3);
    }
  });
});
