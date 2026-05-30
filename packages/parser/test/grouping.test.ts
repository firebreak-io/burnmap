import { describe, it, expect } from 'vitest';
import { groupByModule, parseOutputs } from '../src/grouping.js';
import type { ResourceChange } from '../src/types.js';
import type { RawChange } from '../src/plan-json.js';

function rc(partial: Partial<ResourceChange>): ResourceChange {
  return {
    address: 'x', module: '', type: 't', name: 'n', provider: 'p',
    action: 'create', attrs: [], dangerScore: 0, dangerReasons: [],
    ...partial,
  };
}

describe('groupByModule', () => {
  it('groups by module then type', () => {
    const groups = groupByModule([
      rc({ module: 'module.vpc', type: 'aws_subnet', address: 'a' }),
      rc({ module: 'module.vpc', type: 'aws_subnet', address: 'b' }),
      rc({ module: 'module.vpc', type: 'aws_route_table', address: 'c' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.module).toBe('module.vpc');
    const types = groups[0]!.types.map((t) => t.type).sort();
    expect(types).toEqual(['aws_route_table', 'aws_subnet']);
  });

  it('orders modules by highest danger score first', () => {
    const groups = groupByModule([
      rc({ module: 'module.vpc', type: 'aws_subnet', dangerScore: 10 }),
      rc({ module: 'module.data', type: 'aws_db_instance', dangerScore: 100 }),
    ]);
    expect(groups.map((g) => g.module)).toEqual(['module.data', 'module.vpc']);
  });

  it('orders resources within a type by danger desc then address', () => {
    const groups = groupByModule([
      rc({ module: 'm', type: 't', address: 'low', dangerScore: 10 }),
      rc({ module: 'm', type: 't', address: 'high', dangerScore: 90 }),
    ]);
    expect(groups[0]!.types[0]!.resources.map((r) => r.address)).toEqual(['high', 'low']);
  });
});

describe('parseOutputs', () => {
  it('skips no-op outputs and flags sensitive ones', () => {
    const outputs: Record<string, RawChange> = {
      vpc_id: { actions: ['create'], before: null, after: 'vpc-1' },
      unchanged: { actions: ['no-op'], before: 'x', after: 'x' },
      db_password: { actions: ['update'], before: null, after: null, after_sensitive: true },
    };
    const result = parseOutputs(outputs);
    expect(result.map((o) => o.name)).toEqual(['db_password', 'vpc_id']);
    expect(result.find((o) => o.name === 'db_password')!.sensitive).toBe(true);
  });
});
