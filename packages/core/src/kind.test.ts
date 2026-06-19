import { describe, expect, it } from 'vitest';
import { detectKind, resolveTitle, taskFromDoc } from './kind.js';

describe('detectKind', () => {
  it('prefers an explicit, valid type over path conventions', () => {
    expect(detectKind('wiki/x.md', { type: 'task' })).toBe('task');
  });

  it('ignores an unknown explicit type and falls back to conventions', () => {
    expect(detectKind('wiki/x.md', { type: 'bogus' })).toBe('wiki');
  });

  it('maps top-level folders to kinds', () => {
    expect(detectKind('wiki/a.md', {})).toBe('wiki');
    expect(detectKind('raw/a.md', {})).toBe('raw');
    expect(detectKind('journal/2026-06-19.md', {})).toBe('journal');
    expect(detectKind('agents/a.md', {})).toBe('agent');
    expect(detectKind('reports/a.md', {})).toBe('report');
    expect(detectKind('chats/a.md', {})).toBe('chat');
  });

  it('treats inbox items as tasks only when they have a status', () => {
    expect(detectKind('inbox/a.md', { status: 'todo' })).toBe('task');
    expect(detectKind('inbox/a.md', {})).toBe('note');
  });

  it('classifies project files vs tasks vs notes under projects/', () => {
    expect(detectKind('projects/foo/project.md', {})).toBe('project');
    expect(detectKind('projects/foo/tasks/t1.md', {})).toBe('task');
    expect(detectKind('projects/foo/notes/n.md', {})).toBe('note');
  });

  it('defaults unknown locations to note', () => {
    expect(detectKind('random/a.md', {})).toBe('note');
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

  it('derives project from the projects/<slug>/ path when not explicit', () => {
    expect(taskFromDoc('projects/alpha/tasks/t.md', {}, '').project).toBe('alpha');
  });

  it('prefers an explicit project field over the path', () => {
    expect(taskFromDoc('projects/alpha/tasks/t.md', { project: 'beta' }, '').project).toBe('beta');
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
