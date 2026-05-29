import { describe, it, expect } from 'vitest';
import {
  HIGH_RISK_THRESHOLD, isHighRisk, highRiskList, formatValue, formatAttr, relativeAddress,
} from '../src/model-view';
import type { ChangeModel, ResourceChange, AttrChange } from '@burnmap/parser';

function rc(p: Partial<ResourceChange>): ResourceChange {
  return {
    address: 'aws_x.y', module: '', type: 'aws_x', name: 'y', provider: 'p',
    action: 'update', attrs: [], dangerScore: 0, dangerReasons: [], ...p,
  };
}

describe('isHighRisk', () => {
  it('is true at or above the threshold, false below', () => {
    expect(isHighRisk(rc({ dangerScore: HIGH_RISK_THRESHOLD }))).toBe(true);
    expect(isHighRisk(rc({ dangerScore: HIGH_RISK_THRESHOLD - 1 }))).toBe(false);
  });
});

describe('highRiskList', () => {
  it('flattens all modules and returns only high-risk, sorted by danger desc', () => {
    const model = {
      modules: [
        { module: 'module.vpc', types: [{ type: 'aws_subnet', resources: [rc({ address: 'a', dangerScore: 10 })] }] },
        { module: 'module.data', types: [{ type: 'aws_db_instance', resources: [
          rc({ address: 'db', dangerScore: 100, action: 'replace' }),
        ] }] },
        { module: '', types: [{ type: 'aws_s3_bucket', resources: [rc({ address: 'bk', dangerScore: 70, action: 'delete' })] }] },
      ],
    } as unknown as ChangeModel;
    expect(highRiskList(model).map((r) => r.address)).toEqual(['db', 'bk']);
  });
});

describe('formatValue', () => {
  it('quotes strings and JSON-encodes everything else', () => {
    expect(formatValue('t3.micro')).toBe('"t3.micro"');
    expect(formatValue(200)).toBe('200');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(true)).toBe('true');
  });
});

describe('formatAttr', () => {
  it('renders before → after with quoted strings', () => {
    const a: AttrChange = { path: 'engine_version', before: '14.7', after: '15.4', sensitive: false, unknown: false, forcesReplacement: false };
    expect(formatAttr(a)).toBe('engine_version "14.7" → "15.4"');
  });
  it('shows «sensitive» without quotes for sensitive attrs', () => {
    const a: AttrChange = { path: 'password', before: '«sensitive»', after: '«sensitive»', sensitive: true, unknown: false, forcesReplacement: false };
    expect(formatAttr(a)).toBe('password «sensitive» → «sensitive»');
  });
  it('shows (known after apply) without quotes for unknown after', () => {
    const a: AttrChange = { path: 'arn', before: 'old', after: '(known after apply)', sensitive: false, unknown: true, forcesReplacement: false };
    expect(formatAttr(a)).toBe('arn "old" → (known after apply)');
  });
});

describe('relativeAddress', () => {
  it('strips the module prefix', () => {
    expect(relativeAddress(rc({ address: 'module.vpc.aws_subnet.public[0]', module: 'module.vpc' }))).toBe('aws_subnet.public[0]');
  });
  it('returns the full address for the root module', () => {
    expect(relativeAddress(rc({ address: 'aws_s3_bucket.logs', module: '' }))).toBe('aws_s3_bucket.logs');
  });
});
