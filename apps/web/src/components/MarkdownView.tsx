import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Color from '@tiptap/extension-color';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { Markdown } from 'tiptap-markdown';
import { lowlight } from '../lib/lowlight';

/**
 * Read-only markdown renderer. Reuses TipTap (same extensions as the editor)
 * so rendering matches what the editor produces; no separate parser needed.
 */
export function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: true } }),
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      Markdown.configure({ html: true, linkify: true }),
    ],
    content: markdown,
    editorProps: {
      attributes: { class: className ?? 'prose prose-stone max-w-none' },
    },
  });

  // Keep in sync when the source changes (e.g. the agent rewrites the journal).
  useEffect(() => {
    if (editor) editor.commands.setContent(markdown);
  }, [markdown, editor]);

  return <EditorContent editor={editor} />;
}
