import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Layout, type PageRoute } from './components/Layout.tsx';
import { AuthPages } from './pages/AuthPages.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import {
  EnvironmentsPage,
  ProjectDetailsPage,
  ProjectsPage,
} from './pages/ProjectsEnvironmentsPages.tsx';
import {
  FeatureFlagsPage,
  FlagFormPage,
  type FlagRecord,
} from './pages/FlagsListFormPages.tsx';
import {
  FlagDetailsPage,
  TargetingRulesPage,
} from './pages/FlagDetailTargetingPages.tsx';
import {
  RolloutManagementPage,
  SegmentsPage,
} from './pages/SegmentsRolloutPages.tsx';
import {
  ApprovalsPage,
  AuditLogsPage,
  VersionHistoryPage,
} from './pages/GovernancePages.tsx';
import {
  AnalyticsPage,
  ExperimentsPage,
  FlagHygienePage,
} from './pages/ExperimentsAnalyticsPages.tsx';
import {
  ProfilePage,
  SettingsPage,
  UserManagementPage,
} from './pages/AdminSettingsProfilePages.tsx';

interface FlagShipHistoryState {
  flagshipNav: true;
  idx: number;
  route: PageRoute;
  selectedFlag: FlagRecord | null;
  selectedExperimentId: number | null;
}

function isFlagShipHistoryState(state: unknown): state is FlagShipHistoryState {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { flagshipNav?: unknown }).flagshipNav === true &&
    typeof (state as { idx?: unknown }).idx === 'number' &&
    typeof (state as { route?: unknown }).route === 'string'
  );
}

function FlagShipAppShell() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState<PageRoute>('dashboard');
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedFlag, setSelectedFlag] = useState<FlagRecord | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<number | null>(null);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [maxHistoryIndex, setMaxHistoryIndex] = useState(0);

  const historyIndexRef = useRef(0);
  const maxHistoryIndexRef = useRef(0);
  const routeRef = useRef<PageRoute>('dashboard');
  const selectedFlagRef = useRef<FlagRecord | null>(null);
  const selectedExperimentIdRef = useRef<number | null>(null);

  routeRef.current = route;
  selectedFlagRef.current = selectedFlag;
  selectedExperimentIdRef.current = selectedExperimentId;

  // Initialize browser history state when authenticated
  useEffect(() => {
    if (!user) return;

    const currentState = window.history.state;
    if (isFlagShipHistoryState(currentState)) {
      setRoute(currentState.route);
      setSelectedFlag(currentState.selectedFlag ?? null);
      setSelectedExperimentId(currentState.selectedExperimentId ?? null);
      historyIndexRef.current = currentState.idx;
      maxHistoryIndexRef.current = Math.max(maxHistoryIndexRef.current, currentState.idx);
      setHistoryIndex(currentState.idx);
      setMaxHistoryIndex(maxHistoryIndexRef.current);
    } else {
      const initialState: FlagShipHistoryState = {
        flagshipNav: true,
        idx: 0,
        route: 'dashboard',
        selectedFlag: null,
        selectedExperimentId: null,
      };
      window.history.replaceState(initialState, '');
      historyIndexRef.current = 0;
      maxHistoryIndexRef.current = 0;
      setHistoryIndex(0);
      setMaxHistoryIndex(0);
    }

    const handlePopState = (event: PopStateEvent) => {
      if (!isFlagShipHistoryState(event.state)) return;
      const next = event.state;
      setRoute(next.route);
      setSelectedFlag(next.selectedFlag ?? null);
      setSelectedExperimentId(next.selectedExperimentId ?? null);
      historyIndexRef.current = next.idx;
      maxHistoryIndexRef.current = Math.max(maxHistoryIndexRef.current, next.idx);
      setHistoryIndex(next.idx);
      setMaxHistoryIndex(maxHistoryIndexRef.current);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [user?.id]);

  const navigate = useCallback(
    (
      nextRoute: PageRoute,
      extras?: { flag?: FlagRecord | null; experimentId?: number | null }
    ) => {
      const nextFlag = extras && 'flag' in extras ? (extras.flag ?? null) : selectedFlagRef.current;
      const nextExpId =
        extras && 'experimentId' in extras
          ? (extras.experimentId ?? null)
          : selectedExperimentIdRef.current;

      const sameRoute =
        nextRoute === routeRef.current &&
        nextFlag?.id === selectedFlagRef.current?.id &&
        nextExpId === selectedExperimentIdRef.current;

      if (extras && 'flag' in extras) setSelectedFlag(nextFlag);
      if (extras && 'experimentId' in extras) setSelectedExperimentId(nextExpId);
      setRoute(nextRoute);

      if (sameRoute) return;

      const nextIdx = historyIndexRef.current + 1;
      const nextState: FlagShipHistoryState = {
        flagshipNav: true,
        idx: nextIdx,
        route: nextRoute,
        selectedFlag: nextFlag,
        selectedExperimentId: nextExpId,
      };
      window.history.pushState(nextState, '');
      historyIndexRef.current = nextIdx;
      maxHistoryIndexRef.current = nextIdx;
      setHistoryIndex(nextIdx);
      setMaxHistoryIndex(nextIdx);
    },
    []
  );

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < maxHistoryIndex;

  const handleGoBack = useCallback(() => {
    if (historyIndexRef.current > 0) {
      window.history.back();
    }
  }, []);

  const handleGoForward = useCallback(() => {
    if (historyIndexRef.current < maxHistoryIndexRef.current) {
      window.history.forward();
    }
  }, []);

  // Support Alt + Left Arrow and Alt + Right Arrow keyboard shortcuts
  useEffect(() => {
    if (!user) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleGoBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleGoForward();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [user?.id, handleGoBack, handleGoForward]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
          <span className="h-5 w-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
          Loading FlagShip workspace...
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPages />;
  }

  const handleSelectFlag = (flag: FlagRecord, nextRoute: PageRoute) => {
    navigate(nextRoute, { flag });
  };

  const renderPage = () => {
    switch (route) {
      case 'dashboard':
        return <DashboardPage onNavigate={navigate} />;
      case 'projects':
        return <ProjectsPage onOpenProject={() => navigate('project-details')} />;
      case 'project-details':
        return <ProjectDetailsPage onNavigate={navigate} />;
      case 'environments':
        return <EnvironmentsPage />;
      case 'flags':
        return (
          <FeatureFlagsPage
            globalSearch={globalSearch}
            onNavigate={navigate}
            onSelectFlag={handleSelectFlag}
          />
        );
      case 'flag-create':
        return <FlagFormPage mode="create" onDone={() => navigate('flags')} />;
      case 'flag-edit':
        return (
          <FlagFormPage
            mode="edit"
            initialFlag={selectedFlag}
            onDone={() => navigate('flags')}
          />
        );
      case 'flag-details':
        return (
          <FlagDetailsPage
            flagId={selectedFlag?.id ?? null}
            onNavigate={navigate}
            onSelectFlag={handleSelectFlag}
          />
        );
      case 'targeting':
        return <TargetingRulesPage selectedFlagId={selectedFlag?.id ?? null} />;
      case 'segments':
        return <SegmentsPage />;
      case 'rollouts':
        return <RolloutManagementPage selectedFlagId={selectedFlag?.id ?? null} />;
      case 'approvals':
        return <ApprovalsPage />;
      case 'versions':
        return <VersionHistoryPage />;
      case 'audit-logs':
        return <AuditLogsPage />;
      case 'experiments':
        return (
          <ExperimentsPage
            onOpenAnalytics={(expId) => {
              navigate('analytics', { experimentId: expId });
            }}
          />
        );
      case 'analytics':
        return <AnalyticsPage selectedExperimentId={selectedExperimentId} />;
      case 'hygiene':
        return <FlagHygienePage />;
      case 'users':
        return <UserManagementPage />;
      case 'settings':
        return <SettingsPage />;
      case 'profile':
        return <ProfilePage />;
      default:
        return <DashboardPage onNavigate={navigate} />;
    }
  };

  return (
    <Layout
      route={route}
      onNavigate={navigate}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onGoBack={handleGoBack}
      onGoForward={handleGoForward}
      globalSearch={globalSearch}
      onGlobalSearchChange={setGlobalSearch}
    >
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <FlagShipAppShell />
      </AuthProvider>
    </ThemeProvider>
  );
}
