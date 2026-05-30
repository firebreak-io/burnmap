import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModuleGroupView } from '../src/components/ModuleGroupView';
import type { ModuleGroup } from '@burnmap/parser';

const group: ModuleGroup = {
  module: 'module.vpc',
  types: [
    { type: 'aws_subnet', resources: [
      { address: 'module.vpc.aws_subnet.a', module: 'module.vpc', type: 'aws_subnet', name: 'a', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
      { address: 'module.vpc.aws_subnet.b', module: 'module.vpc', type: 'aws_subnet', name: 'b', provider: 'aws', action: 'create', attrs: [], dangerScore: 10, dangerReasons: [] },
    ] },
  ],
};

describe('ModuleGroupView', () => {
  it('shows the module header with a total resource count and renders each resource', () => {
    render(<ModuleGroupView group={group} />);
    expect(screen.getByText('module.vpc')).toBeInTheDocument();
    expect(screen.getByText('· 2')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('labels the root module as "root"', () => {
    render(<ModuleGroupView group={{ ...group, module: '' }} />);
    expect(screen.getByText('root')).toBeInTheDocument();
  });
});
