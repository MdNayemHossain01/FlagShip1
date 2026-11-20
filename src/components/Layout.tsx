import React, { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  Flag,
  FolderKanban,
  GitBranch,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  Sun,
  User,
  Users,
  X,
  FlaskConical,
  AlertCircle,
  Info,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';

export type PageRoute =
  | 'dashboard'
  | 'projects'
  | 'project-details'
  | 'environments'
  | 'flags'
  | 'flag-create'
  | 'flag-edit'
  | 'flag-details'
  | 'targeting'
  | 'segments'
  | 'rollouts'
  | 'approvals'
  | 'versions'
  | 'audit-logs'
  | 'experiments'
  | 'analytics'
  | 'hygiene'
  | 'users'
  | 'settings'
  | 'profile';

interface NavGroup {
  label: string;
  items: Array<{ id: PageRoute; label: string; icon: React.ComponentType<{ className?: string }> }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'projects', label: 'Projects', icon: FolderKanban },
      { id: 'environments', label: 'Environments', icon: Layers },
    ],
  },
  {
    label: 'Feature Delivery',
    items: [
      { id: 'flags', label: 'Feature Flags', icon: Flag },
      { id: 'targeting', label: 'Targeting Rules', icon: Sliders },
      { id: 'segments', label: 'Segments', icon: Users },
      { id: 'rollouts', label: 'Rollout Manager', icon: GitBranch },
    ],
  },
  {
    label: 'Governance',
    items: [
      { id: 'approvals', label: 'Approvals', icon: ClipboardCheck },
      { id: 'versions', label: 'Version History', icon: History },
      { id: 'audit-logs', label: 'Audit Logs', icon: ShieldCheck },
      { id: 'hygiene', label: 'Flag Hygiene', icon: Activity },
    ],
  },
  {
    label: 'Experimentation',
    items: [
      { id: 'experiments', label: 'Experiments', icon: FlaskConical },
      { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'users', label: 'User Management', icon: Users },
      { id: 'settings', label: 'Settings & SDK', icon: Settings },
    ],
  },
];

const ROUTE_TITLES: Record<PageRoute, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  'project-details': 'Project Details',
  environments: 'Environments',
  flags: 'Feature Flags',
  'flag-create': 'Create Flag',
  'flag-edit': 'Edit Flag',
  'flag-details': 'Flag Details',
  targeting: 'Targeting Rules Builder',
  segments: 'Segments',
  rollouts: 'Rollout Management',
  approvals: 'Approval Requests',
  versions: 'Version History',
  'audit-logs': 'Audit Logs',
  experiments: 'Experiments',
  analytics: 'Experiment Analytics',
  hygiene: 'Flag Hygiene',
  users: 'User Management',
  settings: 'Settings & SDK',
  profile: 'Profile',
};

interface LayoutProps {
  route: PageRoute;
  onNavigate: (route: PageRoute) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  globalSearch: string;
  onGlobalSearchChange: (q: string) => void;
  children: React.ReactNode;
}

export function Layout({
  route,
  onNavigate,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  globalSearch,
  onGlobalSearchChange,
  children,
}: LayoutProps) {
  const {
    user,
    projects,
    selectedProject,
    selectedEnvironment,
    setSelectedProjectId,
    setSelectedEnvironmentId,
    logout,
    notifications,
    clearNotifications,
    toasts,
    dismissToast,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const handleNavClick = (target: PageRoute) => {
    onNavigate(target);
    setMobileOpen(false);
  };

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      {/* Brand header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => handleNavClick('dashboard')}
          className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-sm">
            FS
          </span>
          {(!collapsed || isMobile) && (
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap">
              FlagShip
            </span>
          )}
        </button>
        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="p-2 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:flex p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Navigation groups */}
      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {(!collapsed || isMobile) && (
              <p className="px-2.5 mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  route === item.id ||
                  (item.id === 'flags' && ['flag-create', 'flag-edit', 'flag-details'].includes(route)) ||
                  (item.id === 'projects' && route === 'project-details');
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      title={collapsed && !isMobile ? item.label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-50'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-[width] duration-200 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="sticky top-0 h-screen">{renderSidebarContent(false)}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-72 max-w-[85vw] h-full">{renderSidebarContent(true)}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800">
          <div className="h-16 px-4 lg:px-6 flex items-center justify-between gap-3">
            {/* Left: Mobile Toggle + Breadcrumb + Desktop Selectors */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                className="lg:hidden p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 shrink-0"
              >
                <Menu className="h-5 w-5" />
              </button>

              {/* Browser History Back & Forward Navigation */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onGoBack}
                  disabled={!canGoBack}
                  title="Go Back"
                  aria-label="Go Back"
                  className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onGoForward}
                  disabled={!canGoForward}
                  title="Go Forward"
                  aria-label="Go Forward"
                  className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <span className="sm:hidden text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50 truncate">
                FlagShip
              </span>

              <div className="hidden 2xl:flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => onNavigate('projects')}
                  className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                >
                  {selectedProject?.name || 'Workspace'}
                </button>
                <span aria-hidden="true">/</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {ROUTE_TITLES[route]}
                </span>
              </div>

              {/* Desktop Project & Environment Selectors */}
              <div className="hidden sm:flex items-center gap-2 min-w-0">
                <label className="sr-only" htmlFor="global-project-select">
                  Select Project
                </label>
                <select
                  id="global-project-select"
                  value={selectedProject?.id || ''}
                  onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                  className="h-9 max-w-[210px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <label className="sr-only" htmlFor="global-env-select">
                  Select Environment
                </label>
                <select
                  id="global-env-select"
                  value={selectedEnvironment?.id || ''}
                  onChange={(e) => setSelectedEnvironmentId(Number(e.target.value))}
                  className="h-9 max-w-[135px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {(selectedProject?.environments || []).map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

          {/* Right: Search, Notifications, Theme Switcher, User Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex items-center relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="search"
                value={globalSearch}
                onChange={(e) => {
                  onGlobalSearchChange(e.target.value);
                  if (route !== 'flags' && e.target.value.trim().length > 0) {
                    onNavigate('flags');
                  }
                }}
                placeholder="Search flags..."
                aria-label="Search feature flags"
                className="h-9 w-44 xl:w-52 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((o) => !o);
                  setProfileOpen(false);
                }}
                aria-label="Open live notifications"
                className="relative h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Bell className="h-4 w-4" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-blue-600 text-[10px] font-semibold text-white flex items-center justify-center tabular-nums">
                    {notifications.length}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3 z-40">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Real-Time SSE Events
                    </span>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={clearNotifications}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                      Listening for live flag and approval updates.
                    </p>
                  ) : (
                    <ul className="max-h-64 overflow-y-auto space-y-2">
                      {notifications.map((n) => (
                        <li
                          key={n.id}
                          className="text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70"
                        >
                          <p className="text-slate-900 dark:text-slate-100 font-medium">{n.summary}</p>
                          <p className="text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                            {n.event} · {n.timestamp}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Mandatory Day / Night Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              title={theme === 'dark' ? 'Switch to Day Mode' : 'Switch to Night Mode'}
              className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-xs font-medium whitespace-nowrap"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-4 w-4 text-amber-400" />
                  <span className="hidden sm:inline">Day</span>
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-slate-600" />
                  <span className="hidden sm:inline">Night</span>
                </>
              )}
            </button>

            {/* User Profile Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileOpen((o) => !o);
                  setNotifOpen(false);
                }}
                aria-label="Open user menu"
                className="h-9 pl-2 pr-2.5 flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <span className="h-6 w-6 rounded-md bg-blue-600 text-white text-xs font-semibold flex items-center justify-center">
                  {user?.avatarInitials || 'FS'}
                </span>
                <span className="hidden sm:inline text-xs font-medium text-slate-800 dark:text-slate-200 max-w-[110px] truncate">
                  {user?.fullName}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-2 z-40">
                  <div className="px-2.5 py-2 border-b border-slate-200 dark:border-slate-800 mb-1">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {user?.fullName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {user?.email} · {user?.role}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onNavigate('profile');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                  >
                    <User className="h-3.5 w-3.5" />
                    Profile & Security
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onNavigate('settings');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    SDK & Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      void logout();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg mt-1"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Mobile Project & Environment Context Strip */}
          <div className="sm:hidden px-4 pb-2.5 flex items-center gap-2">
            <label className="sr-only" htmlFor="mobile-project-select">
              Select Project (Mobile)
            </label>
            <select
              id="mobile-project-select"
              value={selectedProject?.id || ''}
              onChange={(e) => setSelectedProjectId(Number(e.target.value))}
              className="h-9 flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="mobile-env-select">
              Select Environment (Mobile)
            </label>
            <select
              id="mobile-env-select"
              value={selectedEnvironment?.id || ''}
              onChange={(e) => setSelectedEnvironmentId(Number(e.target.value))}
              className="h-9 w-[132px] shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {(selectedProject?.environments || []).map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>

      {/* Toast Notifications */}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3.5 text-sm"
          >
            {t.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : t.type === 'error' ? (
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            ) : (
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900 dark:text-slate-100 text-xs">{t.title}</p>
              {t.detail && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Reusable Accessible Confirmation Dialog
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
        <h3 id="confirm-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${
              danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
