import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MarkdownContent from './MarkdownContent.svelte';

describe('MarkdownContent', () => {
  it('renders markdown task items as disabled checkboxes', () => {
    const { container } = render(MarkdownContent, {
      source: '- [ ] Pending item\n- [x] Completed item\n- [X] Uppercase completed item',
    });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();
    expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true);
    expect(container.querySelector('ul')).toHaveClass('contains-task-list');
    expect(container.querySelectorAll('.task-list-item')).toHaveLength(3);
  });

  it('keeps ordinary list items and non-task bracket text unchanged', () => {
    const { container } = render(MarkdownContent, {
      source: '- Ordinary item\n- [maybe] Bracketed item',
    });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('[maybe] Bracketed item')).toBeInTheDocument();
    expect(container.querySelector('ul')).not.toHaveClass('contains-task-list');
  });
});
