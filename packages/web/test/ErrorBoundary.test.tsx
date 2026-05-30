import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders children when there is no error', () => {
    render(<ErrorBoundary><p>hello</p></ErrorBoundary>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders a fallback card (not a crash) when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // silence React error log
    const { container } = render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(container.querySelector('.card')).not.toBeNull();
    expect(screen.getByText(/failed to render/i)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
  });
});
