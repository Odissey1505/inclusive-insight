import { lazy, Suspense, Component, type ReactNode } from 'react';
import { HashRouter, Route, Routes, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './hooks/useApp';
import { FeedbackProvider } from './components/ui/feedback';
import { AppLayout, RequireStudent } from './components/layout/AppLayout';
import { PageSkeleton, Button } from './components/ui';
import Welcome from './pages/Welcome';
import Dashboard from './pages/Dashboard';

const Journal = lazy(() => import('./pages/Journal'));
const ObservationView = lazy(() => import('./pages/ObservationView'));
const ObservationForm = lazy(() => import('./pages/ObservationForm'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const SchedulePage = lazy(() => import('./pages/Schedule'));
const ScheduleWizard = lazy(() => import('./pages/ScheduleWizard'));
const Analytics = lazy(() => import('./pages/Analytics'));
const IEP = lazy(() => import('./pages/IEP'));
const Achievements = lazy(() => import('./pages/Achievements'));
const Strategies = lazy(() => import('./pages/Strategies'));
const Reports = lazy(() => import('./pages/Reports'));
const StudentProfile = lazy(() => import('./pages/StudentProfile'));
const Settings = lazy(() => import('./pages/Settings'));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
        <h1 className="text-lg font-bold">Щось пішло не так</h1>
        <p className="mt-2 text-sm text-muted">Ваші дані збережено локально. Спробуйте перезавантажити сторінку.</p>
        <pre className="mt-3 overflow-auto rounded-xl bg-bg p-2 text-left text-xs text-muted">{this.state.error.message}</pre>
        <Button className="mt-4" onClick={() => location.reload()}>Перезавантажити</Button>
      </div>
    );
  }
}

const S = ({ children }: { children: ReactNode }) => <RequireStudent>{children}</RequireStudent>;

function Shell() {
  const { ready, user, mode } = useApp();
  if (!ready) return (
    <div className="mx-auto max-w-5xl p-6">
      {mode === 'cloud' && <p className="mb-4 text-center text-sm font-semibold text-muted" role="status">{user ? 'Завантаження ваших даних з хмари…' : 'Перевірка сесії…'}</p>}
      <PageSkeleton />
    </div>
  );
  if (!user) return <Welcome />;
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl p-6"><PageSkeleton /></div>}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<S><Dashboard /></S>} />
          <Route path="journal" element={<S><Journal /></S>} />
          <Route path="journal/:id" element={<S><ObservationView /></S>} />
          <Route path="observation/new" element={<S><ObservationForm /></S>} />
          <Route path="observation/:id/edit" element={<S><ObservationForm /></S>} />
          <Route path="calendar" element={<S><CalendarPage /></S>} />
          <Route path="schedule" element={<S><SchedulePage /></S>} />
          <Route path="schedule/new" element={<S><ScheduleWizard /></S>} />
          <Route path="schedule/:id/edit" element={<S><ScheduleWizard /></S>} />
          <Route path="analytics" element={<S><Analytics /></S>} />
          <Route path="iep" element={<S><IEP /></S>} />
          <Route path="achievements" element={<S><Achievements /></S>} />
          <Route path="strategies" element={<Strategies />} />
          <Route path="reports" element={<S><Reports /></S>} />
          <Route path="student" element={<StudentProfile />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppProvider>
          <FeedbackProvider>
            <Shell />
          </FeedbackProvider>
        </AppProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}
