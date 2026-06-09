import { describe, it, expect } from 'vitest';
import { collectReferences } from '../src/references.js';

describe('collectReferences', () => {
  it('collects top-level references', () => {
    expect(collectReferences({ vpc_id: { references: ['aws_vpc.main.id', 'aws_vpc.main'] } }))
      .toEqual(['aws_vpc.main.id', 'aws_vpc.main']);
  });

  it('collects references nested in blocks and arrays', () => {
    const expr = {
      ingress: [
        { from_port: { constant_value: 0 }, security_groups: { references: ['aws_security_group.lb.id'] } },
      ],
      vpc_id: { references: ['aws_vpc.main.id'] },
    };
    expect(collectReferences(expr).sort())
      .toEqual(['aws_security_group.lb.id', 'aws_vpc.main.id']);
  });

  it('returns empty for constant-only expressions', () => {
    expect(collectReferences({ cidr_block: { constant_value: '10.0.0.0/16' } })).toEqual([]);
  });
});
