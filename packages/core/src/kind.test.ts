import { describe, expect, it } from 'vitest';
import { detectKind, detectZone, resolveTitle, taskFromDoc } from './kind.js';

describe('detectKind', () => {
  it('prefers an explicit, valid type over path conventions', () => {
    expect(detectKind('knowledge/wiki/x.md', { type: 'task' })).toBe('task');
  });

  it('ignores an unknown explicit type and falls back to conventions', () => {
    expect(detectKind('knowledge/wiki/x.md', { type: 'bogus' })).toBe('wiki');
  });

  it('classifies the knowledge zone (inbox + raw are raw, wiki is wiki)', () => {
    expect(detectKind('knowledge/wiki/a.md', {})).toBe('wiki');
    expect(detectKind('knowledge/inbox/article.md', {})).toBe('raw');
    expect(detectKind('knowledge/raw/source.md', {})).toBe('raw');
  });

  it('classifies the work zone (projects, areas, tasks, archive, inbox)', () => {
    expect(detectKind('work/projects/foo/project.md', {})).toBe('project');
    expect(detectKind('work/projects/foo/tasks/t1.md', {})).toBe('task');
    expect(detectKind('work/projects/foo/notes/n.md', {})).toBe('note');
    expect(detectKind('work/areas/health/area.md', {})).toBe('area');
    expect(detectKind('work/areas/health/log.md', {})).toBe('note');
    expect(detectKind('work/archive/projects/old/project.md', {})).toBe('project');
    expect(detectKind('work/archive/projects/old/tasks/t.md', {})).toBe('task');
    expect(detectKind('work/inbox/a.md', { status: 'todo' })).toBe('task');
    expect(detectKind('work/inbox/a.md', {})).toBe('note');
  });

  it('classifies memory and ops folders', () => {
    expect(detectKind('memory/preferences/planning.md', {})).toBe('memory');
    expect(detectKind('journal/2026-06-19.md', {})).toBe('journal');
    expect(detectKind('agents/a.md', {})).toBe('agent');
    expect(detectKind('reports/a.md', {})).toBe('report');
    expect(detectKind('chats/a.md', {})).toBe('chat');
  });

  it('still understands the legacy flat layout (pre-migration)', () => {
    expect(detectKind('wiki/a.md', {})).toBe('wiki');
    expect(detectKind('raw/a.md', {})).toBe('raw');
    expect(detectKind('inbox/a.md', { status: 'todo' })).toBe('task');
    expect(detectKind('projects/foo/project.md', {})).toBe('project');
  });

  it('defaults unknown locations to note', () => {
    expect(detectKind('random/a.md', {})).toBe('note');
  });
});

describe('detectZone', () => {
  it('maps folders to retrieval zones', () => {
    expect(detectZone('knowledge/wiki/a.md')).toBe('knowledge');
    expect(detectZone('knowledge/inbox/a.md')).toBe('knowledge');
    expect(detectZone('work/projects/p/project.md')).toBe('work');
    expect(detectZone('work/inbox/a.md')).toBe('work');
    expect(detectZone('memory/recipes/r.md')).toBe('memory');
    expect(detectZone('journal/2026-06-19.md')).toBe('ops');
    expect(detectZone('chats/c.md')).toBe('ops');
  });

  it('maps legacy folders to zones', () => {
    expect(detectZone('wiki/a.md')).toBe('knowledge');
    expect(detectZone('raw/a.md')).toBe('knowledge');
    expect(detectZone('projects/p/project.md')).toBe('work');
    expect(detectZone('inbox/a.md')).toBe('work');
  });
});

describe('resolveTitle', () => {
  it('uses the frontmatter title first', () => {
    expect(resolveTitle('a/b.md', { title: '  My Title ' }, '# Heading')).toBe('My Title');
  });

  it('falls back to the first H1 heading', () => {
    expect(resolveTitle('a/b.md', {}, 'intro\n# The Heading\nmore')).toBe('The Heading');
  });

  it('falls back to the filename without extension', () => {
    expect(resolveTitle('a/my-note.md', {}, 'no heading here')).toBe('my-note');
  });

  it('ignores a blank frontmatter title', () => {
    expect(resolveTitle('a/b.md', { title: '   ' }, '# H')).toBe('H');
  });
});

describe('taskFromDoc', () => {
  it('defaults an invalid/missing status to inbox', () => {
    expect(taskFromDoc('inbox/a.md', {}, '').status).toBe('inbox');
    expect(taskFromDoc('inbox/a.md', { status: 'nope' }, '').status).toBe('inbox');
  });

  it('keeps a valid status and priority', () => {
    const row = taskFromDoc('inbox/a.md', { status: 'in_progress', priority: 'high' }, '');
    expect(row.status).toBe('in_progress');
    expect(row.priority).toBe('high');
  });

  it('nulls an invalid priority', () => {
    expect(taskFromDoc('inbox/a.md', { priority: 'whenever' }, '').priority).toBeNull();
  });

  it('derives project from the work/projects/<slug>/ path when not explicit', () => {
    expect(taskFromDoc('work/projects/alpha/tasks/t.md', {}, '').project).toBe('alpha');
    expect(taskFromDoc('work/archive/projects/alpha/tasks/t.md', {}, '').project).toBe('alpha');
    // legacy flat path still works
    expect(taskFromDoc('projects/alpha/tasks/t.md', {}, '').project).toBe('alpha');
  });

  it('prefers an explicit project field over the path', () => {
    expect(taskFromDoc('work/projects/alpha/tasks/t.md', { project: 'beta' }, '').project).toBe(
      'beta',
    );
  });

  it('keeps only string tags', () => {
    const row = taskFromDoc('inbox/a.md', { tags: ['x', 2, 'y', null] }, '');
    expect(row.tags).toEqual(['x', 'y']);
  });

  it('passes through string date/meta fields and nulls missing ones', () => {
    const row = taskFromDoc(
      'inbox/a.md',
      { id: 'T-1', due: '2026-06-20', scheduled: '2026-06-21', created: '2026-06-01', source: 'mail' },
      '# Title',
    );
    expect(row).toMatchObject({
      id: 'T-1',
      title: 'Title',
      due: '2026-06-20',
      scheduled: '2026-06-21',
      created: '2026-06-01',
      source: 'mail',
    });
    expect(taskFromDoc('inbox/a.md', {}, '').due).toBeNull();
  });
});
