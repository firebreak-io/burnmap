import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/components/App';
import { sampleModel, emptyModel } from '../src/sample-data';
import type { ChangeModel } from '@burnmap/parser';

describe('App', () => {
  it('renders the brand, context, summary, danger index, and module groups', () => {
    render(<App model={sampleModel} />);
    expect(screen.getByText('burnmap')).toBeInTheDocument();
    expect(screen.getByText(/firebreak-io\/infra · PR #142 · a1b9c2f/)).toBeInTheDocument();
    expect(screen.getByText(/2 high-risk/)).toBeInTheDocument();
    expect(screen.getByText('module.data')).toBeInTheDocument();
    expect(screen.getByText('module.app')).toBeInTheDocument();
  });

  it('matches the rendered DOM snapshot (visual-regression guard)', () => {
    const { container } = render(<App model={sampleModel} />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('shows the no-changes banner and no module groups for an empty plan', () => {
    render(<App model={emptyModel} />);
    expect(screen.getByText('No infrastructure changes')).toBeInTheDocument();
    expect(screen.queryByText(/high-risk/)).not.toBeInTheDocument();
  });

  it('shows the banner AND the outputs section for an output-only plan', () => {
    const outputOnly: ChangeModel = {
      ...emptyModel,
      outputs: [{ name: 'db_endpoint', action: 'update', sensitive: false }],
    };
    render(<App model={outputOnly} />);
    expect(screen.getByText('No infrastructure changes')).toBeInTheDocument();
    expect(screen.getByText('db_endpoint')).toBeInTheDocument();
  });

  it('does not show the no-changes banner when there are resource changes', () => {
    render(<App model={sampleModel} />);
    expect(screen.queryByText('No infrastructure changes')).not.toBeInTheDocument();
  });
});
