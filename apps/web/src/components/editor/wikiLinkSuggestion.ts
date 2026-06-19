import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { api } from '../../api';

interface DocItem {
  title: string;
  path: string;
  insert: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Vanilla popup for the `[[` suggestion (no React root / tippy needed). */
function createRenderer(): SuggestionOptions<DocItem>['render'] {
  return () => {
    let el: HTMLDivElement | null = null;
    let items: DocItem[] = [];
    let selected = 0;
    let pick: ((item: DocItem) => void) | null = null;
    let dismissed = false;

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
        b.className = `block w-full px-3 py-1.5 text-left text-sm ${
          i === selected ? 'bg-active' : 'hover:bg-surface-2'
        }`;
        b.innerHTML = `<div class="truncate text-ink-strong">${escapeHtml(item.title)}</div><div class="truncate font-mono text-[10px] text-faintest">${escapeHtml(item.path)}</div>`;
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick?.(item);
        });
        el!.appendChild(b);
      });
    };

    const place = (rect: DOMRect | null | undefined) => {
      if (!el || !rect) return;
      el.style.top = `${rect.bottom + window.scrollY + 4}px`;
      el.style.left = `${rect.left + window.scrollX}px`;
    };

    return {
      onStart: (props) => {
        dismissed = false;
        items = props.items;
        selected = 0;
        pick = (item) => props.command(item);
        el = document.createElement('div');
        el.className =
          'absolute z-50 max-h-64 w-72 overflow-auto rounded-lg border border-line bg-surface shadow-[var(--shadow-pop)]';
        document.body.appendChild(el);
        draw();
        place(props.clientRect?.());
      },
      onUpdate: (props) => {
        items = props.items;
        selected = 0;
        pick = (item) => props.command(item);
        if (dismissed) {
          if (el) el.style.display = 'none';
          return;
        }
        draw();
        place(props.clientRect?.());
      },
      onKeyDown: (props) => {
        // Dismissed (Esc) or empty list: don't swallow keys — let the editor type.
        if (dismissed || items.length === 0) return false;
        if (props.event.key === 'Escape') {
          dismissed = true;
          if (el) el.style.display = 'none';
          return true;
        }
        const n = items.length;
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
        return false;
      },
      onExit: () => {
        dismissed = false;
        el?.remove();
        el = null;
      },
    };
  };
}

/**
 * `[[` autocomplete: suggests vault documents and inserts a literal
 * `[[target]]` wiki-link (round-trips as markdown text; resolved by the
 * links index). The document list is fetched once when the editor mounts.
 */
export const WikiLinkSuggestion = Extension.create({
  name: 'wikiLinkSuggestion',

  addOptions() {
    return { docs: [] as DocItem[] };
  },

  onCreate() {
    void api.docs().then((docs) => {
      this.options.docs = docs;
    });
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      Suggestion<DocItem>({
        editor: this.editor,
        pluginKey: new PluginKey('wikiLinkSuggestion'),
        char: '[[',
        command: ({ editor, range, props }) => {
          // Trailing space ends the suggestion match so the inserted `[[…]]`
          // (which itself contains `[[`) doesn't immediately re-trigger it.
          editor.chain().focus().insertContentAt(range, `[[${props.insert}]] `).run();
        },
        items: ({ query }) => {
          const q = query.toLowerCase();
          const docs = ext.options.docs as DocItem[];
          return docs
            .filter((d) => d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q))
            .slice(0, 8);
        },
        render: createRenderer(),
      }),
    ];
  },
});
