import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DangerIndex } from '../src/components/DangerIndex';
import { sampleModel } from '../src/sample-data';

describe('DangerIndex', () => {
  it('renders nothing when there are no high-risk changes', () => {
    const { container } = render(<DangerIndex model={{ ...sampleModel, modules: [] }} />);
    expect(container.querySelector('.index')).toBeNull();
  });

  it('lists each high-risk change as a chip linking to its row anchor', () => {
    render(<DangerIndex model={sampleModel} />);
    expect(screen.getByText(/2 high-risk/)).toBeInTheDocument();
    const dbChip = screen.getByText('module.data.aws_db_instance.main').closest('a');
    expect(dbChip).toHaveAttribute('href', '#r-module-data-aws_db_instance-main');
  });
});
