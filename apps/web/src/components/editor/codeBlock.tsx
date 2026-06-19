import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { lowlight } from '../../lib/lowlight';

const LANGS = lowlight.listLanguages().sort();

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const language = (node.attrs.language as string) || '';
  return (
    <NodeViewWrapper className="relative">
      <select
        contentEditable={false}
        value={language}
        onChange={(e) => updateAttributes({ language: e.target.value })}
        className="absolute right-2 top-2 z-10 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-muted focus:outline-none"
      >
        <option value="">auto</option>
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent as={'code' as 'div'} />
      </pre>
    </NodeViewWrapper>
  );
}

/** Code block with syntax highlighting and a language picker (visual paste). */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight });
