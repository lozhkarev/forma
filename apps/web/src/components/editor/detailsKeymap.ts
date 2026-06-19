import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';

/** Find the enclosing details node and whether the cursor is in its summary. */
function summaryContext(state: EditorState) {
  const { $from } = state.selection;
  let detailsDepth = -1;
  let inSummary = false;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'detailsSummary') inSummary = true;
    if (name === 'details') {
      detailsDepth = d;
      break;
    }
  }
  return { detailsDepth, inSummary, $from };
}

/**
 * Toggle (details) keys, Notion-style:
 *  - Enter in the title  → create a new sibling toggle below
 *  - Shift-Enter in title → drop into the toggle body
 * Higher priority than the Details extension so these win.
 */
export const DetailsKeymap = Extension.create({
  name: 'detailsKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { detailsDepth, inSummary, $from } = summaryContext(state);
        if (detailsDepth === -1 || !inSummary || !state.selection.empty) return false;
        const after = $from.after(detailsDepth);
        return this.editor
          .chain()
          .insertContentAt(after, { type: 'paragraph' })
          .setTextSelection(after + 1)
          .setDetails()
          .focus()
          .run();
      },
      'Shift-Enter': () => {
        const editor = this.editor;
        const { state } = editor;
        const { detailsDepth, inSummary, $from } = summaryContext(state);
        if (detailsDepth === -1 || !inSummary) return false;
        const detailsPos = $from.before(detailsDepth);
        const details = state.doc.nodeAt(detailsPos);
        if (!details || details.type.name !== 'details') return false;

        // Position inside the body's first block. Toggling `open` does not
        // change node sizes, so this stays valid afterwards.
        let bodyPos = -1;
        details.forEach((child, offset) => {
          // offset is relative to details' content start; +1 enters
          // detailsContent and +1 more lands inside its first block.
          if (child.type.name === 'detailsContent' && bodyPos === -1) {
            bodyPos = detailsPos + 1 + offset + 2;
          }
        });
        if (bodyPos === -1) return false;

        const placeCaret = () => {
          const pos = Math.min(bodyPos, editor.state.doc.content.size);
          editor.chain().setTextSelection(pos).scrollIntoView().focus().run();
        };

        if (details.attrs.open) {
          // Body is already visible — drop the caret in immediately.
          placeCaret();
        } else {
          // Expand first; the DetailsContent node view un-hides its body via an
          // async DOM event, so a caret set in the same transaction would land
          // in a display:none block and bounce back to the summary. Defer the
          // caret to the next tick, once the body is actually rendered.
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true });
              return true;
            })
            .run();
          setTimeout(placeCaret);
        }
        return true;
      },
    };
  },
});
