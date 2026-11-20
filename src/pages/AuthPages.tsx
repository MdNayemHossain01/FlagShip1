import React, { useState } from 'react';
import { Lock, Mail, Moon, Sun, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';
import type { UserRole } from '../core/types.ts';

const DEMO_ACCOUNTS: Array<{ email: string; role: UserRole; name: string }> = [
  { email: 'admin@flagship.dev', role: 'ADMIN', name: 'Aria Chen' },
  { email: 'editor@flagship.dev', role: 'EDITOR', name: 'Marcus Vance' },
  { email: 'approver@flagship.dev', role: 'APPROVER', name: 'Priya Nair' },
  { email: 'viewer@flagship.dev', role: 'VIEWER', name: 'David Okafor' },
];

const HERO_FEATURES = [
  {
    title: 'Deterministic MurmurHash3 Rollouts',
    detail: 'Consistent bucket assignment across instances. Expanding 10% to 20% retains 100% of the initial cohort.',
  },
  {
    title: 'Two-Person Production Approvals',
    detail: 'Production changes queue with before/after diffs until independently approved; kill switches apply instantly.',
  },
  {
    title: 'Offline-Resilient SDK & SSE',
    detail: 'Real-time Server-Sent Events with polling fallback and local disk snapshots (<= 2s startup cap).',
  },
  {
    title: 'SRM & Z-Test Analytics',
    detail: 'Batched exposure and goal tracking with automated Chi-Square SRM checks and Z-test significance.',
  },
];

export function AuthPages() {
  const { loginWithPassword, registerAccount } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('admin@flagship.dev');
  const [password, setPassword] = useState('FlagShip2026!');
  const [role, setRole] = useState<UserRole>('EDITOR');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await loginWithPassword(email, password);
      } else {
        await registerAccount(fullName, email, password, role);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDemo = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('FlagShip2026!');
    setError(null);
    setSubmitting(true);
    try {
      await loginWithPassword(demoEmail, 'FlagShip2026!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Clean Top Bar */}
      <header className="h-16 px-6 lg:px-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-2.5">
          <span className="h-8 w-8 rounded-lg bg-blue-600 text-white font-bold text-sm flex items-center justify-center">
            FS
          </span>
          <span className="text-lg font-bold tracking-tight">FlagShip</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
            <span>{theme === 'dark' ? 'Day Mode' : 'Night Mode'}</span>
          </button>
        </div>
      </header>

      {/* Stacked Vertical Layout: Concise Hero Feature Overview ABOVE Sign In / Create Account Card */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 sm:py-10 flex flex-col items-center gap-8">
        {/* Concise Hero Feature Overview */}
        <section className="w-full space-y-5 text-center">
          <div className="space-y-2.5 max-w-2xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Enterprise Feature Management &amp; Gradual Rollout
            </p>
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-tight">
              Ship safely with deterministic rollouts and instant kill switches.
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
              Manage Boolean, String, Number, and JSON flags across Development, Staging, and Production with
              real-time Server-Sent Events, two-person approval gates, and statistically rigorous A/B analytics.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-left pt-1">
            {HERO_FEATURES.map((feat) => (
              <div
                key={feat.title}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
              >
                <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {feat.title}
                </h2>
                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {feat.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Sign In / Create Account Card */}
        <section className="w-full max-w-md mx-auto">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
            {/* Mode Switcher */}
            <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setEmail('');
                  setPassword('');
                  setError(null);
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Create Account
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-fullname" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      id="auth-fullname"
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jordan Patel"
                      className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Work Email
                </label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@flagship.dev"
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-role" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Workspace Role
                  </label>
                  <select
                    id="auth-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="EDITOR">Editor (Create &amp; edit flags)</option>
                    <option value="APPROVER">Approver (Review production approvals)</option>
                    <option value="ADMIN">Admin (Full project &amp; user management)</option>
                    <option value="VIEWER">Viewer (Read-only access)</option>
                  </select>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                {submitting ? 'Authenticating...' : mode === 'login' ? 'Sign In to FlagShip' : 'Register & Continue'}
              </button>
            </form>

            {mode === 'login' && (
              <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2.5">
                  Role-Based Evaluation Accounts (Password: FlagShip2026!)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      aria-label={`Sign in as ${acc.role} (${acc.name})`}
                      disabled={submitting}
                      onClick={() => void handleQuickDemo(acc.email)}
                      className="text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 bg-slate-50 dark:bg-slate-800/50 transition-colors"
                    >
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {acc.role}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {acc.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
