import { useQueryClient } from '@tanstack/react-query';
import Link from '@tiptap/extension-link';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import { Markdown } from 'tiptap-markdown';
import type { DocFile } from '@forma/core';
import { api, isConflict } from '../api';
import { Backlinks } from './Backlinks';
import { useChat } from './chat/ChatProvider';
import { SelectionHighlight, selectionHighlightKey } from './editor/selectionHighlight';
import { WikiLinkSuggestion } from './editor/wikiLinkSuggestion';
import { Properties } from './Properties';

function getMarkdown(editor: TiptapEditor): string {
  const md = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
  // tiptap-markdown escapes `[`/`]`; unescape the double brackets so
  // [[wiki-links]] round-trip as text (single \[ stays escaped).
  return md.replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]');
}

interface Props {
  /** Актуальные данные документа из кеша запросов (обновляются по SSE). */
  doc: DocFile;
  onDeleted: () => void;
}

/**
 * Редактор документа. Источник истины — markdown: TipTap парсит body
 * при загрузке и сериализует обратно при сохранении.
 */
export function Editor({ doc, onDeleted }: Props) {
  const queryClient = useQueryClient();
  const chat = useChat();
  // загруженная версия: от неё считаем dirty и оптимистичную блокировку
  const [loaded, setLoaded] = useState(doc);
  const [frontmatter, setFrontmatter] = useState(doc.frontmatter);
  const [dirty, setDirty] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectionText, setSelectionText] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
      WikiLinkSuggestion,
      SelectionHighlight,
    ],
    content: doc.body,
    editorProps: {
      attributes: {
        class: 'prose prose-stone max-w-none px-1 py-4',
      },
    },
    onUpdate: () => setDirty(true),
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      setSelectionText(from === to ? '' : ed.state.doc.textBetween(from, to, '\n').trim());
    },
  });

  const applyDoc = (next: DocFile) => {
    editor?.commands.setContent(next.body);
    setFrontmatter(next.frontmatter);
    setLoaded(next);
    setDirty(false);
    setExternalChange(false);
  };

  // файл изменился на диске (агент/внешний редактор): без правок — перечитываем,
  // с правками — предупреждаем, не теряя введённое
  useEffect(() => {
    if (doc.mtimeMs === loaded.mtimeMs) return;
    if (!dirty) applyDoc(doc);
    else setExternalChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.mtimeMs]);

  // Keep the agent-context selection highlighted (persists when focus leaves).
  useEffect(() => {
    if (!editor) return;
    const sel = chat.contextSelection;
    const range = sel && sel.docPath === loaded.path ? { from: sel.from, to: sel.to } : null;
    editor.view.dispatch(editor.state.tr.setMeta(selectionHighlightKey, range));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.contextSelection, editor, loaded.path]);

  const save = async (force = false) => {
    if (!editor || saving) return;
    setSaving(true);
    try {
      const updated = await api.saveDoc(
        loaded.path,
        frontmatter,
        getMarkdown(editor),
        force ? undefined : loaded.mtimeMs,
      );
      setLoaded(updated);
      // Re-sync so `changed` (which compares frontmatter identity) clears.
      setFrontmatter(updated.frontmatter);
      setDirty(false);
      setExternalChange(false);
      void queryClient.invalidateQueries({ queryKey: ['doc', loaded.path] });
    } catch (err) {
      if (isConflict(err) && window.confirm('File changed on disk. Overwrite with your version?')) {
        await save(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${loaded.path}?`)) return;
    await api.deleteDoc(loaded.path);
    onDeleted();
  };

  const discussSelection = () => {
    if (!editor || !selectionText) {
      chat.startWithDoc(loaded.path);
      return;
    }
    const { from, to } = editor.state.selection;
    const startLine = editor.state.doc.textBetween(0, from, '\n', '\n').split('\n').length;
    const endLine = editor.state.doc.textBetween(0, to, '\n', '\n').split('\n').length;
    const lines = startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`;
    chat.startWithSelection({ docPath: loaded.path, from, to, lines, text: selectionText });
  };

  const changed = dirty || frontmatter !== loaded.frontmatter;

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <span className="truncate font-mono text-xs text-faintest">{loaded.path}</span>
        <span className="ml-auto" />
        {externalChange && (
          <button
            onClick={() => applyDoc(doc)}
            className="rounded-lg bg-amber-100 px-3 py-1 text-xs text-amber-800 hover:bg-amber-200"
            title="File changed on disk. Click to reload (your edits will be lost)."
          >
            ⟳ changed on disk
          </button>
        )}
        <button
          onClick={discussSelection}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-active"
          title={
            selectionText
              ? 'Discuss the selected text with the agent'
              : 'Discuss this document with the agent'
          }
        >
          ✦ {selectionText ? 'Discuss selection' : 'Discuss'}
        </button>
        <button
          onClick={() => void save()}
          disabled={!changed || saving}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white disabled:bg-line-strong"
        >
          {saving ? 'Saving…' : changed ? 'Save' : 'Saved'}
        </button>
        <button
          onClick={() => void remove()}
          className="rounded-lg px-2 py-1.5 text-sm text-faintest hover:bg-rose-50 hover:text-rose-600"
          title="Delete document"
        >
          🗑
        </button>
      </div>
      <div className="border-b border-line bg-surface px-6 py-2">
        <Properties
          frontmatter={frontmatter}
          onChange={(fm) => {
            setFrontmatter(fm);
            setDirty(true);
          }}
        />
      </div>
      <div className="flex-1 overflow-auto bg-surface px-6 pb-10">
        <EditorContent editor={editor} className="mx-auto max-w-3xl" />
        <Backlinks path={loaded.path} />
      </div>
    </div>
  );
}
