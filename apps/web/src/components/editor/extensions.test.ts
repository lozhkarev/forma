// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { editorExtensions } from './extensions';

let editor: Editor | null = null;

function mount(content: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: editorExtensions(), content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** The placeholder text the extension wrote onto the empty block. */
function placeholderOf(ed: Editor, selector: string): string | null {
  const el = ed.view.dom.querySelector(`${selector}.is-empty`) ?? ed.view.dom.querySelector(selector);
  return el?.getAttribute('data-placeholder') ?? null;
}

describe('editor placeholders', () => {
  it('shows the AI / slash hint on the focused empty paragraph', () => {
    const ed = mount('<p></p>');
    ed.commands.focus('start');
    expect(placeholderOf(ed, 'p')).toContain('commands');
  });

  it('labels an empty to-do item', () => {
    const ed = mount(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>',
    );
    expect(placeholderOf(ed, 'li[data-checked] p')).toBe('To-do');
  });

  it('labels an empty bullet item', () => {
    const ed = mount('<ul><li><p></p></li></ul>');
    expect(placeholderOf(ed, 'li p')).toBe('List');
  });

  it('labels an empty heading', () => {
    const ed = mount('<h2></h2>');
    expect(placeholderOf(ed, 'h2')).toBe('Heading 2');
  });
});
