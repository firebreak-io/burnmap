import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Outputs } from '../src/components/Outputs';

describe('Outputs', () => {
  it('renders nothing when there are no output changes', () => {
    const { container } = render(<Outputs outputs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists output names with their action and a sensitive marker', () => {
    render(<Outputs outputs={[
      { name: 'db_endpoint', action: 'update', sensitive: false },
      { name: 'db_password', action: 'create', sensitive: true },
    ]} />);
    expect(screen.getByText('db_endpoint')).toBeInTheDocument();
    expect(screen.getByText('db_password')).toBeInTheDocument();
    expect(screen.getByText(/sensitive/)).toBeInTheDocument();
  });
});
