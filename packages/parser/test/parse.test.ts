import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePlan } from '../src/parse.js';
import type { ChangeMeta } from '../src/types.js';
import type { RawPlan } from '../src/plan-json.js';

function fixture(name: string): RawPlan {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as RawPlan;
}

const meta: ChangeMeta = {
  repo: 'firebreak/infra', prNumber: 142, commitSha: 'a1b9c2f',
  terraformVersion: '1.12.1', generatedAt: '2026-05-29T00:00:00Z',
};

describe('parsePlan', () => {
  it('summarizes and excludes no-op resources from the manifest', () => {
    const model = parsePlan(fixture('simple-create.json'), meta);
    expect(model.summary).toEqual({ create: 1, update: 0, delete: 0, replace: 0, noop: 1, read: 0 });
    const addrs = model.modules.flatMap((m) => m.types.flatMap((t) => t.resources.map((r) => r.address)));
    expect(addrs).toEqual(['module.vpc.aws_subnet.public[0]']);
    expect(model.outputs.map((o) => o.name)).toEqual(['subnet_id']);
  });

  it('models a stateful replace + destroy with danger ordering', () => {
    const model = parsePlan(fixture('replace-db.json'), meta);
    expect(model.summary.replace).toBe(1);
    expect(model.summary.delete).toBe(1);
    // module.data (replace, stateful, forced) outranks the root destroy module
    expect(model.modules[0]!.module).toBe('module.data');
    const db = model.modules[0]!.types[0]!.resources[0]!;
    expect(db.action).toBe('replace');
    expect(db.dangerReasons.some((r) => r.includes('forces replacement: engine_version'))).toBe(true);
    expect(db.attrs.find((a) => a.path === 'engine_version')!.forcesReplacement).toBe(true);
  });

  it('never leaks sensitive values anywhere in the model', () => {
    const model = parsePlan(fixture('sensitive.json'), meta);
    const json = JSON.stringify(model);
    expect(json).not.toContain('OLD_SECRET_VALUE');
    expect(json).not.toContain('NEW_SECRET_VALUE');
    expect(json).toContain('«sensitive»');
  });

  it('handles an empty plan', () => {
    const model = parsePlan(fixture('empty.json'), meta);
    expect(model.modules).toEqual([]);
    expect(model.outputs).toEqual([]);
    expect(model.summary).toEqual({ create: 0, update: 0, delete: 0, replace: 0, noop: 0, read: 0 });
  });

  it('carries meta through unchanged', () => {
    const model = parsePlan(fixture('empty.json'), meta);
    expect(model.meta).toEqual(meta);
  });

  it('overrides meta.terraformVersion with the plan version when they differ', () => {
    // empty.json declares terraform_version "1.12.1"; the plan file is authoritative.
    const model = parsePlan(fixture('empty.json'), { ...meta, terraformVersion: '1.0.0' });
    expect(model.meta.terraformVersion).toBe('1.12.1');
  });
});
