import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Layout } from './components/Layout';
import { AgentsPage } from './pages/AgentsPage';
import { BoardPage } from './pages/BoardPage';
import { DocsPage } from './pages/DocsPage';
import { GraphPage } from './pages/GraphPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/TasksPage';
import { TodayPage } from './pages/TodayPage';
import { WeekPage } from './pages/WeekPage';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Survive the packaged sidecar's cold start (~10s): keep retrying with a
      // capped backoff so the first queries succeed once the server is up.
      retry: 8,
      retryDelay: (n) => Math.min(500 * 2 ** n, 2000),
      refetchOnWindowFocus: false,
    },
  },
});

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/today' });
  },
});

export const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/today',
  component: TodayPage,
});

export const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: TasksPage,
});

export const weekRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/week',
  component: WeekPage,
});

export const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsPage,
});

export const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/board',
  component: BoardPage,
  validateSearch: (search: Record<string, unknown>): { project?: string } => ({
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
});

export const graphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/graph',
  component: GraphPage,
});

export const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: AgentsPage,
});

export const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: ReportsPage,
});

export const docsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs',
  component: DocsPage,
  validateSearch: (search: Record<string, unknown>): { path?: string } => ({
    path: typeof search.path === 'string' ? search.path : undefined,
  }),
});

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  todayRoute,
  tasksRoute,
  weekRoute,
  projectsRoute,
  boardRoute,
  graphRoute,
  agentsRoute,
  reportsRoute,
  docsRoute,
  settingsRoute,
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Surface fatal startup errors in the window instead of a blank white screen
// (the packaged app has no easy console access).
function showFatal(message: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText =
    'margin:0;padding:24px;font:12px/1.5 ui-monospace,monospace;color:#b91c1c;white-space:pre-wrap;word-break:break-word';
  pre.textContent = `Forma failed to start:\n\n${message}`;
  root.appendChild(pre);
}
// Async failures (e.g. an API call before the sidecar is ready) must NOT wipe
// the app — only log them. The overlay is reserved for a synchronous mount crash.
window.addEventListener('error', (e) => console.error('[forma] error:', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[forma] rejection:', e.reason));

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
} catch (err) {
  showFatal(err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err));
}
