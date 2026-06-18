import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const selectionHighlightKey = new PluginKey<DecorationSet>('selectionHighlight');

export interface HighlightRange {
  from: number;
  to: number;
}

/**
 * Keeps a fragment highlighted even when the editor loses focus — used to mark
 * the selection that was sent to the agent as context. Driven externally via a
 * transaction meta: `tr.setMeta(selectionHighlightKey, {from,to} | null)`.
 * The decoration is mapped across edits so it stays on the right text.
 */
export const SelectionHighlight = Extension.create({
  name: 'selectionHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: selectionHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, deco) {
            const meta = tr.getMeta(selectionHighlightKey) as HighlightRange | null | undefined;
            if (meta !== undefined) {
              if (!meta || meta.from === meta.to) return DecorationSet.empty;
              const size = tr.doc.content.size;
              const from = Math.max(0, Math.min(meta.from, size));
              const to = Math.max(from, Math.min(meta.to, size));
              return DecorationSet.create(tr.doc, [
                Decoration.inline(from, to, { class: 'ctx-highlight' }),
              ]);
            }
            return deco.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return selectionHighlightKey.getState(state);
          },
        },
      }),
    ];
  },
});
