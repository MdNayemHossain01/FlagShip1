import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Plus, RefreshCw, Rocket } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';
import type { PageRoute } from '../components/Layout.tsx';
import { QuickStartWizard } from '../components/QuickStartWizard.tsx';

interface DashboardData {
  kpis: {
    totalProjects: number;
    totalFlags: number;
    activeFlags: number;
    disabledFlags: number;
    activeRollouts: number;
    totalEnvironments: number;
    pendingApprovals: number;
    staleFlags: number;
  };
  activitySeries: Array<{ day: string; iso: string; changes: number; evaluations: number }>;
  rolloutDistribution: Array<{ range: string; count: number }>;
  recentActivity: Array<{
    id: number;
    actorName: string;
    action: string;
    entityId: string;
    summary: string;
    createdAt: string;
  }>;
  recentFlagChanges: Array<{
    id: number;
    versionNumber: number;
    changeReason: string;
    createdAt: string;
    flagKey: string;
    flagName: string;
    envName: string;
    authorName: string | null;
  }>;
  environmentSummary: Array<{
    id: number;
    key: string;
    name: string;
    color: string;
    requiresApproval: boolean;
    activeFlags: number;
    disabledFlags: number;
    killSwitched: number;
    totalEvaluations: number;
  }>;
}

export function DashboardPage({ onNavigate }: { onNavigate: (r: PageRoute) => void }) {
  const { selectedProject, selectedEnvironment, sseVersion } = useAuth();
  const { theme } = useTheme();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchDashboard = async () => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('projectId', String(selectedProject.id));
      if (selectedEnvironment) qs.set('environmentId', String(selectedEnvironment.id));
      const res = await api.get<DashboardData>(`/dashboard?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboard();
  }, [selectedProject?.id, selectedEnvironment?.id, sseVersion]);

  const axisColor = theme === 'dark' ? '#94a3b8' : '#64748b';
  const gridColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';
  const tooltipStyle = {
    backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
    borderColor: theme === 'dark' ? '#334155' : '#e2e8f0',
    color: theme === 'dark' ? '#f8fafc' : '#0f172a',
    borderRadius: '8px',
    fontSize: '12px',
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-6 text-sm text-red-700 dark:text-red-300">
        {error || 'No dashboard data available.'}
      </div>
    );
  }

  const kpiCards = [
    { label: 'Total Projects', value: data.kpis.totalProjects, route: 'projects' as PageRoute },
    { label: 'Total Flags', value: data.kpis.totalFlags, route: 'flags' as PageRoute },
    { label: 'Active Flags', value: data.kpis.activeFlags, tone: 'text-emerald-600 dark:text-emerald-400', route: 'flags' as PageRoute },
    { label: 'Disabled Flags', value: data.kpis.disabledFlags, route: 'flags' as PageRoute },
    { label: 'Active Rollouts', value: data.kpis.activeRollouts, tone: 'text-blue-600 dark:text-blue-400', route: 'rollouts' as PageRoute },
    { label: 'Total Environments', value: data.kpis.totalEnvironments, route: 'environments' as PageRoute },
    { label: 'Pending Approvals', value: data.kpis.pendingApprovals, tone: data.kpis.pendingApprovals > 0 ? 'text-amber-600 dark:text-amber-400' : '', route: 'approvals' as PageRoute },
    { label: 'Stale Flags', value: data.kpis.staleFlags, tone: data.kpis.staleFlags > 0 ? 'text-red-600 dark:text-red-400' : '', route: 'hygiene' as PageRoute },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header + Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Platform Overview
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            {selectedProject?.name} · {selectedEnvironment?.name} environment live telemetry
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchDashboard()}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="h-9 px-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Rocket className="h-3.5 w-3.5" />
            Quick Start
          </button>
          <button
            type="button"
            onClick={() => onNavigate('approvals')}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            Review Approvals ({data.kpis.pendingApprovals})
          </button>
          <button
            type="button"
            onClick={() => onNavigate('flag-create')}
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Create Flag
          </button>
        </div>
      </div>

      {/* Guided Empty-State Prompt for New Projects */}
      {data.kpis.totalFlags === 0 && (
        <section className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Launch your first feature flag in {selectedProject?.name}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              Use the guided Quick Start Wizard to configure a flag, test live evaluation, and grab your SDK snippet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Rocket className="h-3.5 w-3.5" />
            Launch Quick Start
          </button>
        </section>
      )}

      {/* 8 Real Backend KPIs */}
      <section aria-label="Key platform metrics" className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={() => onNavigate(kpi.route)}
            className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-500/60 dark:hover:border-blue-500/60 transition-colors"
          >
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{kpi.label}</p>
            <p
              className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${
                kpi.tone || 'text-slate-900 dark:text-slate-50'
              }`}
            >
              {kpi.value}
            </p>
          </button>
        ))}
      </section>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Flag Evaluation Activity (7 Days)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Daily evaluations across {selectedEnvironment?.name}
              </p>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.activitySeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="day" stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="evaluations"
                  name="Evaluations"
                  stroke="#2563EB"
                  strokeWidth={2}
                  fill="url(#evalFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Rollout Distribution
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Flags grouped by active traffic exposure
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.rolloutDistribution} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="range" stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={axisColor} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="Flags" fill="#3B82F6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Environment Summary Table */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Environment Summary
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Active flags, kill switches, and approval policies per environment
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('environments')}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            Manage environments
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900">
                <th className="py-2.5 px-5 font-medium">Environment</th>
                <th className="py-2.5 px-4 font-medium">Approval Policy</th>
                <th className="py-2.5 px-4 font-medium text-right">Active</th>
                <th className="py-2.5 px-4 font-medium text-right">Disabled</th>
                <th className="py-2.5 px-4 font-medium text-right">Kill Switched</th>
                <th className="py-2.5 px-5 font-medium text-right">Total Evaluations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {data.environmentSummary.map((env) => (
                <tr key={env.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-5 font-semibold text-slate-900 dark:text-slate-100">
                    {env.name}{' '}
                    <span className="font-mono font-normal text-slate-500 dark:text-slate-400">
                      ({env.key})
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                    {env.requiresApproval ? 'Two-person approval required' : 'Direct publish'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                    {env.activeFlags}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {env.disabledFlags}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-red-600 dark:text-red-400">
                    {env.killSwitched}
                  </td>
                  <td className="py-3 px-5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {env.totalEvaluations.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bottom Row: Recent Flag Changes & Recent Activity */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Flag Changes
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('versions')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Version history
            </button>
          </div>
          {data.recentFlagChanges.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No flag revisions recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.recentFlagChanges.map((item) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {item.flagKey}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      v{item.versionNumber} · {item.envName}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{item.changeReason}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {item.authorName || 'System'} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Audit Activity
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('audit-logs')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Full audit log
            </button>
          </div>
          {data.recentActivity.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No audit entries yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.recentActivity.slice(0, 7).map((log) => (
                <li key={log.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                      {log.summary}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                    {log.actorName} · {log.action} · {new Date(log.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <QuickStartWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onComplete={(next) => {
          void fetchDashboard();
          if (next) onNavigate(next);
        }}
      />
    </div>
  );
}
