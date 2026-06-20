import { Extension, type ChainedCommands, type Range } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

interface SlashItem {
  title: string;
  desc: string;
  icon: string;
  keywords: string;
  apply: (chain: ChainedCommands) => ChainedCommands;
}

const ITEMS: SlashItem[] = [
  { title: 'Text', desc: 'Plain paragraph', icon: '¶', keywords: 'text paragraph plain body', apply: (c) => c.setParagraph() },
  { title: 'Heading 1', desc: 'Large heading', icon: 'H1', keywords: 'h1 heading title large', apply: (c) => c.toggleHeading({ level: 1 }) },
  { title: 'Heading 2', desc: 'Medium heading', icon: 'H2', keywords: 'h2 heading subtitle', apply: (c) => c.toggleHeading({ level: 2 }) },
  { title: 'Heading 3', desc: 'Small heading', icon: 'H3', keywords: 'h3 heading', apply: (c) => c.toggleHeading({ level: 3 }) },
  { title: 'To-do list', desc: 'Checklist with checkboxes', icon: '☑', keywords: 'todo task checkbox check list', apply: (c) => c.toggleTaskList() },
  { title: 'Bullet list', desc: 'Simple bulleted list', icon: '•', keywords: 'bullet unordered list ul', apply: (c) => c.toggleBulletList() },
  { title: 'Numbered list', desc: 'Ordered list', icon: '1.', keywords: 'numbered ordered list ol', apply: (c) => c.toggleOrderedList() },
  { title: 'Toggle', desc: 'Collapsible section', icon: '▸', keywords: 'toggle collapsible details accordion', apply: (c) => c.setDetails() },
  { title: 'Quote', desc: 'Quote block', icon: '❝', keywords: 'quote blockquote', apply: (c) => c.toggleBlockquote() },
  { title: 'Code', desc: 'Code block', icon: '</>', keywords: 'code block fenced ```', apply: (c) => c.toggleCodeBlock() },
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function createRenderer(): SuggestionOptions<SlashItem>['render'] {
  return () => {
    let el: HTMLDivElement | null = null;
    let items: SlashItem[] = [];
    let selected = 0;
    let pick: ((item: SlashItem) => void) | null = null;

    const draw = () => {
      if (!el) return;
      if (items.length === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.innerHTML = '';
      items.forEach((item, i) => {
        const b = document.createElement('button');
        b.className = `flex w-full items-center gap-2.5 px-2 py-1.5 text-left ${
          i === selected ? 'bg-active' : 'hover:bg-surface-2'
        }`;
        b.innerHTML =
          `<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-xs font-semibold text-muted">${escapeHtml(item.icon)}</span>` +
          `<span class="min-w-0"><span class="block truncate text-sm text-ink-strong">${escapeHtml(item.title)}</span><span class="block truncate text-xs text-faintest">${escapeHtml(item.desc)}</span></span>`;
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick?.(item);
        });
        el!.appendChild(b);
      });
    };

    const place = (rect: DOMRect | null | undefined) => {
      if (!el || !rect) return;
      el.style.left = `${rect.left + window.scrollX}px`;
      // Flip above the caret when there isn't room below (e.g. near the page bottom).
      const menuH = el.offsetHeight || 320;
      const flipUp = window.innerHeight - rect.bottom < menuH + 8 && rect.top > menuH + 8;
      el.style.top = flipUp
        ? `${rect.top + window.scrollY - menuH - 4}px`
        : `${rect.bottom + window.scrollY + 4}px`;
    };

    return {
      onStart: (props) => {
        items = props.items;
        selected = 0;
        pick = (item) => props.command(item);
        el = document.createElement('div');
        el.className =
          'absolute z-50 max-h-80 w-72 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]';
        document.body.appendChild(el);
        draw();
        place(props.clientRect?.());
      },
      onUpdate: (props) => {
        items = props.items;
        selected = 0;
        pick = (item) => props.command(item);
        draw();
        place(props.clientRect?.());
      },
      onKeyDown: (props) => {
        const n = items.length;
        if (n === 0) return false;
        if (props.event.key === 'ArrowDown') {
          selected = (selected + 1) % n;
          draw();
          return true;
        }
        if (props.event.key === 'ArrowUp') {
          selected = (selected - 1 + n) % n;
          draw();
          return true;
        }
        if (props.event.key === 'Enter') {
          pick?.(items[selected]);
          return true;
        }
        if (props.event.key === 'Escape') {
          if (el) el.style.display = 'none';
          return true;
        }
        return false;
      },
      onExit: () => {
        el?.remove();
        el = null;
      },
    };
  };
}

/** Notion-style `/` menu to insert blocks (headings, lists, todo, code, …). */
export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashMenu'),
        char: '/',
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          props.apply(editor.chain().focus().deleteRange(range)).run();
        },
        items: ({ query }) => {
          const q = query.toLowerCase();
          return ITEMS.filter(
            (it) => it.title.toLowerCase().includes(q) || it.keywords.includes(q),
          );
        },
        render: createRenderer(),
      }),
    ];
  },
});
