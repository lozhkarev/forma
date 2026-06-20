import Color from '@tiptap/extension-color';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { Markdown } from 'tiptap-markdown';
import { CodeBlock } from './codeBlock';
import { DetailsKeymap } from './detailsKeymap';
import { SelectionHighlight } from './selectionHighlight';
import { SlashMenu } from './slashMenu';
import { WikiLinkSuggestion } from './wikiLinkSuggestion';

/**
 * Placeholder text per empty block — the Notion-style hints (To-do, List,
 * Heading N, the AI/slash hint on an empty paragraph). Exported so it can be
 * unit-tested against the real config.
 */
export function placeholderText({
  node,
  pos,
  editor,
}: {
  node: ProseMirrorNode;
  pos: number;
  editor: Editor;
}): string {
  const name = node.type.name;
  if (name === 'heading') return `Heading ${node.attrs.level}`;
  if (name === 'detailsSummary') return 'Toggle';
  if (name !== 'paragraph') return '';
  let parent = '';
  try {
    parent = editor.state.doc.resolve(pos).parent.type.name;
  } catch {
    /* position not resolvable mid-transaction */
  }
  if (parent === 'taskItem') return 'To-do';
  if (parent === 'listItem') return 'List';
  if (parent === 'blockquote') return 'Quote';
  const sel = editor.state.selection;
  const focused = sel.empty && sel.$from.parent === node;
  return focused ? 'Press ‘space’ for AI or ‘/’ for commands' : '';
}

/** The document editor's extension stack (shared by the editor and tests). */
export function editorExtensions() {
  return [
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
    CodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    DetailsKeymap,
    Placeholder.configure({
      showOnlyCurrent: false,
      includeChildren: true,
      placeholder: placeholderText,
    }),
    Markdown.configure({ html: true, linkify: true, transformPastedText: true }),
    WikiLinkSuggestion,
    SelectionHighlight,
    SlashMenu,
  ];
}
