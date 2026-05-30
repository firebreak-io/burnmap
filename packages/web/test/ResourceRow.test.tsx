import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResourceRow } from '../src/components/ResourceRow';
import type { ResourceChange } from '@burnmap/parser';

function rc(p: Partial<ResourceChange>): ResourceChange {
  return {
    address: 'aws_x.y', module: '', type: 'aws_x', name: 'y', provider: 'p',
    action: 'create', attrs: [], dangerScore: 10, dangerReasons: [], ...p,
  };
}

describe('ResourceRow', () => {
  it('renders a bare row for a create (no detail)', () => {
    const { container } = render(<ResourceRow rc={rc({ address: 'module.vpc.aws_subnet.public[0]', module: 'module.vpc', type: 'aws_subnet', action: 'create' })} />);
    expect(screen.getByText('+')).toBeInTheDocument();
    expect(screen.getByText('public[0]')).toBeInTheDocument();
    expect(container.querySelector('.detail')).toBeNull();
    expect(container.querySelector('.item.hot')).toBeNull();
  });

  it('renders a high-risk replace as "hot" with reasons, attr diffs, and a force badge', () => {
    const { container } = render(<ResourceRow rc={rc({
      address: 'module.data.aws_db_instance.main', module: 'module.data', type: 'aws_db_instance',
      action: 'replace', dangerScore: 100,
      dangerReasons: ['forces replacement: engine_version'],
      attrs: [{ path: 'engine_version', before: '14.7', after: '15.4', sensitive: false, unknown: false, forcesReplacement: true }],
    })} />);
    expect(container.querySelector('.item.hot')).not.toBeNull();
    expect(screen.getByText('force replace')).toBeInTheDocument();
    expect(screen.getByText(/forces replacement: engine_version/)).toBeInTheDocument();
    // target the attr diff specifically — "14.7" appears only there, not in the reason line
    expect(screen.getByText(/engine_version "14\.7" → "15\.4"/)).toBeInTheDocument();
    expect(container.querySelector('.attr .forces')).not.toBeNull();
  });

  it('renders a destroy with a destroy badge', () => {
    render(<ResourceRow rc={rc({ action: 'delete', dangerScore: 70, dangerReasons: ['resource will be destroyed'] })} />);
    expect(screen.getByText('destroy')).toBeInTheDocument();
    expect(screen.getByText('×')).toBeInTheDocument();
  });

  it('renders a non-high-risk update as a compact attr summary (not hot)', () => {
    const { container } = render(<ResourceRow rc={rc({
      action: 'update', dangerScore: 5,
      attrs: [{ path: 'tags.Version', before: '1.4.0', after: '1.5.0', sensitive: false, unknown: false, forcesReplacement: false }],
    })} />);
    expect(container.querySelector('.item.hot')).toBeNull();
    expect(container.querySelector('.more')).not.toBeNull();
    expect(screen.getByText(/tags.Version "1.4.0" → "1.5.0"/)).toBeInTheDocument();
  });
});
