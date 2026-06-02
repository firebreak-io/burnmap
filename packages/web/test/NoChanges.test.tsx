import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoChanges } from '../src/components/NoChanges';

describe('NoChanges', () => {
  it('shows the headline and explanatory subtext', () => {
    render(<NoChanges />);
    expect(screen.getByText('No infrastructure changes')).toBeInTheDocument();
    expect(
      screen.getByText("This plan won't create, update, or destroy any resources."),
    ).toBeInTheDocument();
  });
});
