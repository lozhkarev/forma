import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { Markdown } from 'tiptap-markdown';

/**
 * Read-only markdown renderer. Reuses TipTap (same extensions as the editor)
 * so rendering matches what the editor produces; no separate parser needed.
 */
export function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, linkify: true }),
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
