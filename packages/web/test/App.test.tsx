import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/components/App';
import { sampleModel } from '../src/sample-data';

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
});
