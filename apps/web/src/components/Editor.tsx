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

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
      WikiLinkSuggestion,
    ],
    content: doc.body,
    editorProps: {
      attributes: {
        class: 'prose prose-stone max-w-none px-1 py-4',
      },
    },
    onUpdate: () => setDirty(true),
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
      <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-6 py-3">
        <span className="truncate font-mono text-xs text-stone-400">{loaded.path}</span>
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
          onClick={() => chat.startWithDoc(loaded.path)}
          className="rounded-lg px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100"
          title="Discuss this document with the agent"
        >
          ✦ Discuss
        </button>
        <button
          onClick={() => void save()}
          disabled={!changed || saving}
          className="rounded-lg bg-stone-900 px-4 py-1.5 text-sm text-white disabled:bg-stone-300"
        >
          {saving ? 'Saving…' : changed ? 'Save' : 'Saved'}
        </button>
        <button
          onClick={() => void remove()}
          className="rounded-lg px-2 py-1.5 text-sm text-stone-400 hover:bg-rose-50 hover:text-rose-600"
          title="Delete document"
        >
          🗑
        </button>
      </div>
      <div className="border-b border-stone-200 bg-white px-6 py-2">
        <Properties
          frontmatter={frontmatter}
          onChange={(fm) => {
            setFrontmatter(fm);
            setDirty(true);
          }}
        />
      </div>
      <div className="flex-1 overflow-auto bg-white px-6 pb-10">
        <EditorContent editor={editor} className="mx-auto max-w-3xl" />
        <Backlinks path={loaded.path} />
      </div>
    </div>
  );
}
