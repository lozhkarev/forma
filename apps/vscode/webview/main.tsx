import Color from '@tiptap/extension-color';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface HostMessage {
  type: 'init' | 'update';
  text: string;
}

/** Serialize the editor body back to Markdown (mirrors the Forma web editor). */
function getMarkdown(editor: Editor): string {
  const md = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
  // tiptap-markdown escapes `[`/`]`; keep [[wiki-links]] readable.
  return md.replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]');
}

/** Split a leading YAML frontmatter block off the body, preserving it verbatim
 *  so it round-trips byte-for-byte (the editor only touches the body). */
function splitFrontmatter(text: string): { fm: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(text);
  return m ? { fm: m[0], body: text.slice(m[0].length) } : { fm: '', body: text };
}

function App() {
  const fmRef = useRef('');
  // The last text we sent to / received from the host, to suppress echo loops.
  const lastTextRef = useRef<string | null>(null);
  const applyingRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? `Heading ${node.attrs.level}` : "Write, or press '/'…",
      }),
      Markdown.configure({ html: true, linkify: true, transformPastedText: true }),
    ],
    content: '',
    editorProps: { attributes: { class: 'forma-doc' } },
    onUpdate: ({ editor: ed }) => {
      if (applyingRef.current) return;
      const text = fmRef.current + getMarkdown(ed);
      lastTextRef.current = text;
      vscode.postMessage({ type: 'edit', text });
    },
  });

  useEffect(() => {
    if (!editor) return;
    const onMessage = (e: MessageEvent<HostMessage>) => {
      const msg = e.data;
      if (msg.type !== 'init' && msg.type !== 'update') return;
      // Ignore the write-back echo of our own edit.
      if (msg.text === lastTextRef.current) return;
      lastTextRef.current = msg.text;
      const { fm, body } = splitFrontmatter(msg.text);
      fmRef.current = fm;
      applyingRef.current = true;
      editor.commands.setContent(body, { emitUpdate: false });
      applyingRef.current = false;
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [editor]);

  return <EditorContent editor={editor} />;
}

createRoot(document.getElementById('root')!).render(<App />);
