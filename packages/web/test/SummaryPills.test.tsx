import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryPills } from '../src/components/SummaryPills';

describe('SummaryPills', () => {
  it('shows add/change/replace/destroy counts with labels', () => {
    render(<SummaryPills summary={{ create: 4, update: 2, delete: 1, replace: 1, noop: 0, read: 0 }} />);
    expect(screen.getByText('add')).toBeInTheDocument();
    expect(screen.getByText('change')).toBeInTheDocument();
    expect(screen.getByText('replace')).toBeInTheDocument();
    expect(screen.getByText('destroy')).toBeInTheDocument();
    // counts render in tabular spans
    expect(screen.getAllByText('4')[0]).toBeInTheDocument();
  });

  it('omits a pill when its count is zero', () => {
    render(<SummaryPills summary={{ create: 0, update: 0, delete: 0, replace: 3, noop: 5, read: 0 }} />);
    expect(screen.queryByText('add')).not.toBeInTheDocument();
    expect(screen.getByText('replace')).toBeInTheDocument();
  });

  it('renders nothing when there are no displayable changes', () => {
    const { container } = render(<SummaryPills summary={{ create: 0, update: 0, delete: 0, replace: 0, noop: 3, read: 1 }} />);
    expect(container.firstChild).toBeNull();
  });
});
