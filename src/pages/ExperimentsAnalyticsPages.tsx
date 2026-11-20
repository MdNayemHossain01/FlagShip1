import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Archive, CheckCircle2, Pause, Play, Plus } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';
import type { ExperimentReport } from '../core/statistics.ts';
import type { FlagRecord } from './FlagsListFormPages.tsx';

interface ExperimentItem {
  id: number;
  flagId: number;
  flagKey: string;
  flagName: string;
  environmentName: string;
  name: string;
  hypothesis: string;
  primaryMetric: string;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED';
  trafficAllocation: number;
  startedAt: string | null;
  report: ExperimentReport;
}

// ---------------- PAGE 17: EXPERIMENTS PAGE ----------------
export function ExperimentsPage({ onOpenAnalytics }: { onOpenAnalytics: (expId: number) => void }) {
  const { selectedProject, selectedEnvironment, notify } = useAuth();
  const [experiments, setExperiments] = useState<ExperimentItem[]>([]);
  const [flags, setFlags] = useState<FlagRecord[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState('');
  const [flagId, setFlagId] = useState<number | ''>('');
  const [hypothesis, setHypothesis] = useState('');
  const [primaryMetric, setPrimaryMetric] = useState('order_completed');

  const loadData = async () => {
    if (!selectedProject || !selectedEnvironment) return;
    const [expRes, flagRes] = await Promise.all([
      api.get<{ data: ExperimentItem[] }>(`/projects/${selectedProject.id}/experiments`),
      api.get<{ data: FlagRecord[] }>(
        `/projects/${selectedProject.id}/flags?environmentId=${selectedEnvironment.id}`
      ),
    ]);
    setExperiments(expRes.data);
    setFlags(flagRes.data);
    if (!flagId && flagRes.data.length > 0) setFlagId(flagRes.data[0].id);
  };

  useEffect(() => {
    void loadData();
  }, [selectedProject?.id, selectedEnvironment?.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !selectedEnvironment || !flagId) return;
    try {
      await api.post(`/projects/${selectedProject.id}/experiments`, {
        flagId: Number(flagId),
        environmentId: selectedEnvironment.id,
        name,
        hypothesis,
        primaryMetric,
        trafficAllocation: 100,
      });
      setName('');
      setHypothesis('');
      setShowCreate(false);
      notify('success', `Experiment '${name}' launched`);
      await loadData();
    } catch (err) {
      notify('error', 'Failed to launch experiment', err instanceof Error ? err.message : undefined);
    }
  };

  const handleStatus = async (id: number, status: 'RUNNING' | 'PAUSED' | 'COMPLETED') => {
    try {
      await api.patch(`/experiments/${id}/status`, { status });
      notify('success', `Experiment marked ${status}`);
      await loadData();
    } catch (err) {
      notify('error', 'Status update failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleRecordEvents = async (expId: number, variationKey: string, exposures: number, conversions: number) => {
    try {
      await api.post(`/experiments/${expId}/events`, { variationKey, exposures, conversions });
      notify('success', `Recorded +${exposures} exposures & +${conversions} conversions for '${variationKey}'`);
      await loadData();
    } catch (err) {
      notify('error', 'Event tracking failed', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Experiments</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Run controlled A/B tests tied to feature flags with exposure tracking and SRM verification.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 self-start"
        >
          <Plus className="h-4 w-4" />
          New Experiment
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold">Launch Experiment</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="exp-name" className="block text-xs font-medium mb-1">
                Experiment Name
              </label>
              <input
                id="exp-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Checkout Express Conversion Test"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label htmlFor="exp-flag" className="block text-xs font-medium mb-1">
                Linked Feature Flag
              </label>
              <select
                id="exp-flag"
                value={flagId}
                onChange={(e) => setFlagId(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
              >
                {flags.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.key}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exp-metric" className="block text-xs font-medium mb-1">
                Primary Goal Metric
              </label>
              <input
                id="exp-metric"
                required
                value={primaryMetric}
                onChange={(e) => setPrimaryMetric(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
              />
            </div>
          </div>
          <div>
            <label htmlFor="exp-hyp" className="block text-xs font-medium mb-1">
              Hypothesis
            </label>
            <textarea
              id="exp-hyp"
              rows={2}
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="State expected conversion impact and guardrail assumptions."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-semibold"
            >
              Launch Experiment
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {experiments.map((exp) => (
          <div
            key={exp.id}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{exp.name}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Flag: <span className="font-mono">{exp.flagKey}</span> · Metric:{' '}
                  <span className="font-mono">{exp.primaryMetric}</span> · Status: {exp.status} ·{' '}
                  {exp.report.srm.totalExposures.toLocaleString()} exposures
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {exp.status === 'RUNNING' ? (
                  <button
                    type="button"
                    onClick={() => void handleStatus(exp.id, 'PAUSED')}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleStatus(exp.id, 'RUNNING')}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenAnalytics(exp.id)}
                  className="h-8 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                >
                  View Analytics Report
                </button>
              </div>
            </div>

            {exp.hypothesis && (
              <p className="text-xs text-slate-600 dark:text-slate-400">{exp.hypothesis}</p>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {exp.report.variations.map((v) => (
                <div
                  key={v.variationKey}
                  className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{v.name}</span>
                    <span className="font-mono text-xs text-blue-600 dark:text-blue-400 font-bold tabular-nums">
                      {v.conversionRate}%
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {v.conversions} / {v.exposures} conversions ({v.observedShare}% share)
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void handleRecordEvents(
                        exp.id,
                        v.variationKey,
                        25,
                        v.isControl ? 3 : 5
                      )
                    }
                    className="w-full h-7 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    + Record 25 Live Events
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- PAGE 18: EXPERIMENT ANALYTICS PAGE ----------------
export function AnalyticsPage({ selectedExperimentId }: { selectedExperimentId: number | null }) {
  const { selectedProject } = useAuth();
  const { theme } = useTheme();
  const [experiments, setExperiments] = useState<ExperimentItem[]>([]);
  const [activeExpId, setActiveExpId] = useState<number | null>(selectedExperimentId);

  useEffect(() => {
    if (!selectedProject) return;
    api
      .get<{ data: ExperimentItem[] }>(`/projects/${selectedProject.id}/experiments`)
      .then((res) => {
        setExperiments(res.data);
        const found = res.data.find((e) => e.id === (selectedExperimentId || activeExpId)) || res.data[0];
        if (found) setActiveExpId(found.id);
      })
      .catch(() => {});
  }, [selectedProject?.id, selectedExperimentId]);

  const active = experiments.find((e) => e.id === activeExpId) || experiments[0] || null;
  const axisColor = theme === 'dark' ? '#94a3b8' : '#64748b';
  const gridColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';

  if (!active) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
        No experiments available for analytics yet.
      </div>
    );
  }

  const { report } = active;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Experiment Analytics</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Conversion rates, two-proportion Z-test significance, and Chi-Square SRM diagnostics.
          </p>
        </div>
        <select
          aria-label="Select experiment for analytics"
          value={active.id}
          onChange={(e) => setActiveExpId(Number(e.target.value))}
          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
        >
          {experiments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.flagKey})
            </option>
          ))}
        </select>
      </div>

      {/* SRM Health Banner */}
      <div
        className={`rounded-xl border p-4 flex items-start gap-3 ${
          report.srm.mismatchDetected
            ? 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30'
            : 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20'
        }`}
      >
        {report.srm.mismatchDetected ? (
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        )}
        <div className="text-xs space-y-1">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            Sample Ratio Mismatch (SRM) Check: {report.srm.mismatchDetected ? 'MISMATCH DETECTED' : 'HEALTHY TRAFFIC SPLIT'}
          </p>
          <p className="text-slate-600 dark:text-slate-300 font-mono tabular-nums">
            Chi-Square = {report.srm.chiSquare} · df = {report.srm.degreesOfFreedom} · p-value = {report.srm.pValue} · Total Exposures = {report.srm.totalExposures.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Conversion Chart & Statistical Table */}
      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold mb-4">Conversion Rate by Variation (%)</h2>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.variations}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="variationKey" stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke={axisColor} fontSize={12} unit="%" tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{
                    fill: theme === 'dark' ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.04)',
                  }}
                  contentStyle={{
                    backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
                    borderColor: theme === 'dark' ? '#334155' : '#e2e8f0',
                    color: theme === 'dark' ? '#f8fafc' : '#0f172a',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="conversionRate" name="Conversion Rate (%)" fill="#2563EB" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 overflow-x-auto">
          <h2 className="text-sm font-semibold mb-4">Statistical Significance Summary</h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 pr-3 font-medium">Variation</th>
                <th className="py-2 px-2 font-medium text-right">Exposures</th>
                <th className="py-2 px-2 font-medium text-right">Conv. Rate</th>
                <th className="py-2 px-2 font-medium text-right">Relative Lift</th>
                <th className="py-2 px-2 font-medium text-right">p-value</th>
                <th className="py-2 pl-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
              {report.variations.map((v) => (
                <tr key={v.variationKey}>
                  <td className="py-3 pr-3 font-sans font-semibold text-slate-900 dark:text-slate-100">
                    {v.name}
                  </td>
                  <td className="py-3 px-2 text-right">{v.exposures}</td>
                  <td className="py-3 px-2 text-right font-semibold">{v.conversionRate}%</td>
                  <td className="py-3 px-2 text-right">
                    {v.relativeLift === null ? 'Baseline' : `${v.relativeLift > 0 ? '+' : ''}${v.relativeLift}%`}
                  </td>
                  <td className="py-3 px-2 text-right">{v.pValue === null ? '—' : v.pValue}</td>
                  <td className="py-3 pl-2 text-right font-sans">
                    {v.isControl ? (
                      <span className="text-slate-500">Control</span>
                    ) : v.statisticallySignificant ? (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Significant (p &lt; 0.05)</span>
                    ) : (
                      <span className="text-slate-500">Inconclusive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Documented Statistical Assumptions & Limitations */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 grid md:grid-cols-2 gap-6 text-xs">
        <div>
          <h2 className="text-sm font-semibold mb-2">Statistical Assumptions</h2>
          <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 list-disc pl-4">
            {report.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold mb-2">Known Limitations</h2>
          <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 list-disc pl-4">
            {report.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

// ---------------- PAGE 19: FLAG HYGIENE PAGE ----------------
interface StaleFlagItem {
  flagId: number;
  flagKey: string;
  flagName: string;
  ownerName: string;
  reasonType: 'UNUSED_30_DAYS' | 'FULL_ROLLOUT_14_DAYS';
  reasonLabel: string;
  lastEvaluatedAt: string | null;
  rolloutPercentage: number;
  suggestedAction: string;
}

export function FlagHygienePage() {
  const { selectedProject, selectedEnvironment, notify } = useAuth();
  const [items, setItems] = useState<StaleFlagItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHygiene = async () => {
    if (!selectedProject || !selectedEnvironment) return;
    setLoading(true);
    try {
      const res = await api.get<{ data: StaleFlagItem[] }>(
        `/projects/${selectedProject.id}/hygiene?environmentId=${selectedEnvironment.id}`
      );
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHygiene();
  }, [selectedProject?.id, selectedEnvironment?.id]);

  const handleArchive = async (item: StaleFlagItem) => {
    try {
      await api.post(`/flags/${item.flagId}/archive`);
      notify('success', `Archived stale flag '${item.flagKey}'`);
      await loadHygiene();
    } catch (err) {
      notify('error', 'Archive failed', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Flag Hygiene</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Automatically detects flags not evaluated for 30+ days or sitting at 100% rollout for 14+ days.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-6 h-32 animate-pulse bg-slate-100 dark:bg-slate-800" />
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
            <p className="text-sm font-semibold">All feature flags are healthy</p>
            <p className="text-xs text-slate-500">
              No flags exceed the 30-day inactivity or 14-day full-rollout technical debt threshold.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 text-slate-500">
                  <th className="py-3 px-4 font-medium">Stale Flag</th>
                  <th className="py-3 px-3 font-medium">Owner</th>
                  <th className="py-3 px-3 font-medium">Last Evaluation</th>
                  <th className="py-3 px-3 font-medium text-right">Rollout %</th>
                  <th className="py-3 px-3 font-medium">Suggested Cleanup Action</th>
                  <th className="py-3 px-4 font-medium text-right">Cleanup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {items.map((item) => (
                  <tr key={item.flagId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{item.flagName}</p>
                      <p className="font-mono text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                        {item.flagKey} · {item.reasonLabel}
                      </p>
                    </td>
                    <td className="py-3.5 px-3">{item.ownerName}</td>
                    <td className="py-3.5 px-3 font-mono tabular-nums text-slate-500">
                      {item.lastEvaluatedAt ? new Date(item.lastEvaluatedAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums font-semibold">
                      {item.rolloutPercentage}%
                    </td>
                    <td className="py-3.5 px-3 text-slate-600 dark:text-slate-300 max-w-xs">
                      {item.suggestedAction}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void handleArchive(item)}
                        className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Archive Flag
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
