import type { TaskPriority, TaskStatus } from '@forma/core';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: 'Входящие',
  todo: 'Сделать',
  in_progress: 'В работе',
  blocked: 'Заблокировано',
  done: 'Готово',
  cancelled: 'Отменено',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  inbox: 'bg-stone-200 text-stone-700',
  todo: 'bg-sky-100 text-sky-800',
  in_progress: 'bg-amber-100 text-amber-800',
  blocked: 'bg-rose-100 text-rose-800',
  done: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-stone-100 text-stone-400',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'низкий',
  normal: 'обычный',
  high: 'высокий',
  urgent: 'срочно',
};

export const PRIORITY_DOTS: Record<TaskPriority, string> = {
  low: 'bg-stone-300',
  normal: 'bg-sky-400',
  high: 'bg-amber-500',
  urgent: 'bg-rose-500',
};

export function isOverdue(due: string | null): boolean {
  if (!due) return false;
  return due < new Date().toISOString().slice(0, 10);
}
