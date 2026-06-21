import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface GNode extends SimulationNodeDatum {
  id: string;
  title: string;
  kind: string;
  degree: number;
}
type GLink = SimulationLinkDatum<GNode>;

const KIND_COLOR: Record<string, string> = {
  wiki: '#2c6fdb',
  project: '#7c3aed',
  task: '#2e8b57',
  journal: '#b8651b',
  note: '#8d8a82',
};

export function GraphPage() {
  const navigate = useNavigate();
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 700 });
  const [, tick] = useState(0); // rerender on each simulation tick
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const neighbors = useRef<Map<string, Set<string>>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });

  // Wheel zoom toward the cursor (non-passive so preventDefault works).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => {
        const k = Math.min(4, Math.max(0.2, v.k * factor));
        const gx = (mx - v.x) / v.k;
        const gy = (my - v.y) / v.k;
        return { x: mx - gx * k, y: my - gy * k, k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [graph.data]);

  // Pan by dragging the background (not a node).
  const startPan = (e: React.PointerEvent) => {
    if (e.target !== svgRef.current) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = view;
    const move = (ev: PointerEvent) =>
      setView({ k: start.k, x: start.x + (ev.clientX - sx), y: start.y + (ev.clientY - sy) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!graph.data) return;
    const degree = new Map<string, number>();
    for (const e of graph.data.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const nodes: GNode[] = graph.data.nodes.map((n) => ({
      id: n.path,
      title: n.title,
      kind: n.kind,
      degree: degree.get(n.path) ?? 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: GLink[] = graph.data.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    const adj = new Map<string, Set<string>>();
    for (const e of links) {
      const s = e.source as string;
      const t = e.target as string;
      (adj.get(s) ?? adj.set(s, new Set()).get(s)!).add(t);
      (adj.get(t) ?? adj.set(t, new Set()).get(t)!).add(s);
    }
    neighbors.current = adj;
    nodesRef.current = nodes;
    linksRef.current = links;

    const sim = forceSimulation(nodes)
      .force('charge', forceManyBody().strength(-220))
      .force('link', forceLink<GNode, GLink>(links).id((d) => d.id).distance(70))
      .force('center', forceCenter(size.w / 2, size.h / 2))
      .force('collide', forceCollide(24))
      .on('tick', () => tick((t) => t + 1));
    simRef.current = sim;
    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.data, size.w, size.h]);

  const isLit = (id: string) =>
    !hover || hover === id || neighbors.current.get(hover)?.has(id) === true;

  const startDrag = (node: GNode, e: React.PointerEvent) => {
    e.stopPropagation();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    const move = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      node.fx = (ev.clientX - r.left - view.x) / view.k;
      node.fy = (ev.clientY - r.top - view.y) / view.k;
      simRef.current?.alphaTarget(0.3).restart();
    };
    const up = () => {
      node.fx = null;
      node.fy = null;
      simRef.current?.alphaTarget(0);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const empty = graph.data && graph.data.nodes.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-6 pt-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Graph</h1>
        <span className="text-xs text-faintest">
          {graph.data ? `${graph.data.nodes.length} notes · ${graph.data.edges.length} links` : ''}
        </span>
        <span className="ml-auto text-xs text-faintest">scroll to zoom · drag bg to pan</span>
        <button
          onClick={() => setView({ x: 0, y: 0, k: 1 })}
          className="rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-active"
        >
          Reset
        </button>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        {empty && (
          <div className="flex h-full items-center justify-center text-sm text-faintest">
            No links yet — connect notes with [[wiki-links]].
          </div>
        )}
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          onPointerDown={startPan}
          className="block cursor-grab active:cursor-grabbing"
        >
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {linksRef.current.map((l, i) => {
            const s = l.source as GNode;
            const t = l.target as GNode;
            if (s.x == null || t.x == null) return null;
            const lit = !hover || isLit(s.id) === true || isLit(t.id) === true;
            const active = hover != null && (s.id === hover || t.id === hover);
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={active ? 'var(--color-accent)' : 'var(--color-line-strong)'}
                strokeWidth={active ? 1.5 : 1}
                opacity={lit ? 1 : 0.15}
              />
            );
          })}
          {nodesRef.current.map((n) => {
            if (n.x == null) return null;
            const r = 5 + Math.min(n.degree, 8) * 1.5;
            const lit = isLit(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                className="cursor-pointer"
                opacity={lit ? 1 : 0.25}
                onPointerDown={(e) => startDrag(n, e)}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => navigate({ to: '/docs', search: { path: n.id } })}
              >
                <circle r={r} fill={KIND_COLOR[n.kind] ?? KIND_COLOR.note} />
                {(hover === n.id || n.degree > 2) && (
                  <text
                    x={r + 3}
                    y={4}
                    className={clsx('select-none text-[11px]', hover === n.id ? 'fill-ink' : 'fill-muted')}
                  >
                    {n.title}
                  </text>
                )}
              </g>
            );
          })}
          </g>
        </svg>
      </div>
    </div>
  );
}
