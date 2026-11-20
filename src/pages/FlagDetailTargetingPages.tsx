import React, { useEffect, useState } from 'react';
import { AlertOctagon, Play, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import type { PageRoute } from '../components/Layout.tsx';
import type { FlagRecord } from './FlagsListFormPages.tsx';
import type { EvaluationResult, RuleCondition, RuleGroup, RuleOperator, TargetingRuleDef } from '../core/types.ts';

const ALL_OPERATORS: Array<{ value: RuleOperator; label: string }> = [
  { value: 'EQUALS', label: 'Equals' },
  { value: 'NOT_EQUALS', label: 'Not Equals' },
  { value: 'IN', label: 'In (comma list)' },
  { value: 'NOT_IN', label: 'Not In (comma list)' },
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'STARTS_WITH', label: 'Starts With' },
  { value: 'ENDS_WITH', label: 'Ends With' },
  { value: 'REGEX', label: 'Regex Match' },
  { value: 'SEMVER_GT', label: 'SemVer Greater Than' },
  { value: 'SEMVER_LT', label: 'SemVer Less Than' },
  { value: 'DATE_BEFORE', label: 'Date Before (ISO)' },
  { value: 'DATE_AFTER', label: 'Date After (ISO)' },
];

// ---------------- PAGE 10: FLAG DETAILS & LIVE EVALUATOR ----------------
export function FlagDetailsPage({
  flagId,
  onNavigate,
  onSelectFlag,
}: {
  flagId: number | null;
  onNavigate: (r: PageRoute) => void;
  onSelectFlag: (f: FlagRecord, next: PageRoute) => void;
}) {
  const { selectedProject, selectedEnvironment, sseVersion, notify } = useAuth();
  const [flag, setFlag] = useState<FlagRecord | null>(null);
  const [loading, setLoading] = useState(true);

  // Live evaluation previewer state
  const [evalUserKey, setEvalUserKey] = useState('user-1042');
  const [evalAttrsJson, setEvalAttrsJson] = useState(
    '{\n  "country": "US",\n  "plan": "enterprise",\n  "appVersion": "2.4.0",\n  "email": "alice@flagship.dev"\n}'
  );
  const [evalResult, setEvalResult] = useState<EvaluationResult | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const loadFlag = async () => {
    if (!selectedProject || !selectedEnvironment) return;
    setLoading(true);
    try {
      const res = await api.get<{ data: FlagRecord[] }>(
        `/projects/${selectedProject.id}/flags?environmentId=${selectedEnvironment.id}`
      );
      const found = flagId ? res.data.find((f) => f.id === flagId) : res.data[0];
      setFlag(found || null);
    } catch (err) {
      notify('error', 'Failed to load flag details', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFlag();
  }, [flagId, selectedProject?.id, selectedEnvironment?.id, sseVersion]);

  const handleEvaluate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flag || !selectedEnvironment) return;
    setEvaluating(true);
    try {
      const attributes = JSON.parse(evalAttrsJson);
      const res = await api.post<EvaluationResult>(
        `/flags/${flag.id}/environments/${selectedEnvironment.id}/evaluate`,
        { userKey: evalUserKey, attributes }
      );
      setEvalResult(res);
    } catch (err) {
      notify('error', 'Evaluation error', err instanceof Error ? err.message : 'Check attributes JSON');
    } finally {
      setEvaluating(false);
    }
  };

  const handleQuickAction = async (payload: Record<string, unknown>, label: string) => {
    if (!flag || !selectedEnvironment) return;
    try {
      const res = await api.post<{ pendingApproval: boolean; message?: string }>(
        `/flags/${flag.id}/environments/${selectedEnvironment.id}/config`,
        { ...payload, changeReason: label }
      );
      if (res.pendingApproval) notify('info', 'Approval Queued', res.message);
      else notify('success', label);
      await loadFlag();
    } catch (err) {
      notify('error', 'Update failed', err instanceof Error ? err.message : undefined);
    }
  };

  if (loading) {
    return <div className="h-48 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />;
  }
  if (!flag) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-400">Select a flag to inspect its details.</p>
        <button
          type="button"
          onClick={() => onNavigate('flags')}
          className="mt-3 h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-semibold"
        >
          View Feature Flags
        </button>
      </div>
    );
  }

  const cfg = flag.envConfig;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{flag.name}</h1>
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
            {flag.key} · {flag.flagType} · {selectedEnvironment?.name} · v{cfg?.version ?? 1}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSelectFlag(flag, 'targeting')}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            Edit Targeting Rules
          </button>
          <button
            type="button"
            onClick={() => onSelectFlag(flag, 'rollouts')}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            Manage Rollout
          </button>
          <button
            type="button"
            onClick={() => onSelectFlag(flag, 'flag-edit')}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            Edit Metadata
          </button>
          <button
            type="button"
            onClick={() =>
              void handleQuickAction(
                { killSwitch: !(cfg?.killSwitch ?? false) },
                cfg?.killSwitch ? `Clear kill switch on ${flag.key}` : `Emergency kill switch on ${flag.key}`
              )
            }
            className="h-9 px-3.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <AlertOctagon className="h-3.5 w-3.5" />
            {cfg?.killSwitch ? 'Clear Kill Switch' : 'Kill Switch'}
          </button>
        </div>
      </div>

      {/* Status & Summary Grid */}
      <div className="grid sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Environment State</p>
          <p className="mt-1.5 text-base font-bold">
            {cfg?.killSwitch ? (
              <span className="text-red-600 dark:text-red-400">Kill Switched</span>
            ) : cfg?.enabled ? (
              <span className="text-emerald-600 dark:text-emerald-400">Enabled</span>
            ) : (
              <span className="text-slate-500">Disabled</span>
            )}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Gradual Rollout</p>
          <p className="mt-1.5 text-base font-bold font-mono tabular-nums">
            {cfg?.rolloutPercentage ?? 0}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Targeting Rules</p>
          <p className="mt-1.5 text-base font-bold font-mono tabular-nums">{flag.rules.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Total Evaluations</p>
          <p className="mt-1.5 text-base font-bold font-mono tabular-nums">
            {(cfg?.evaluationCount ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Variations & Description */}
        <section className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold">Variations & Evaluation Order</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {flag.description || 'No description provided.'}
          </p>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
            {flag.variations.map((v) => (
              <div key={v.variationKey} className="py-3 flex items-start justify-between gap-3 text-xs">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{v.name}</p>
                  <p className="font-mono text-slate-500">{v.variationKey}</p>
                </div>
                <code className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] max-w-[220px] truncate">
                  {JSON.stringify(v.value)}
                </code>
              </div>
            ))}
          </div>
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p className="font-semibold text-slate-700 dark:text-slate-200">
              Strict Evaluation Precedence:
            </p>
            <p>1. Kill switch → 2. Individual user target → 3. Segments & rules → 4. MurmurHash3 % rollout → 5. Default variation</p>
          </div>
        </section>

        {/* Live Evaluation Previewer */}
        <section className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold">Live Evaluation Previewer</h2>
          <form onSubmit={handleEvaluate} className="space-y-3">
            <div>
              <label htmlFor="eval-user-key" className="block text-xs font-medium mb-1">
                User Key
              </label>
              <input
                id="eval-user-key"
                required
                value={evalUserKey}
                onChange={(e) => setEvalUserKey(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
              />
            </div>
            <div>
              <label htmlFor="eval-attrs" className="block text-xs font-medium mb-1">
                User & Custom Attributes (JSON)
              </label>
              <textarea
                id="eval-attrs"
                rows={4}
                value={evalAttrsJson}
                onChange={(e) => setEvalAttrsJson(e.target.value)}
                className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={evaluating}
              className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Play className="h-3.5 w-3.5" />
              {evaluating ? 'Evaluating...' : 'Evaluate Flag'}
            </button>
          </form>

          {evalResult && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Served Variation</span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {evalResult.variationKey} ({JSON.stringify(evalResult.value)})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Decision Reason</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {evalResult.reason}
                  {evalResult.matchedRuleName ? ` (${evalResult.matchedRuleName})` : ''}
                </span>
              </div>
              {evalResult.bucket !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">MurmurHash3 Bucket</span>
                  <span className="font-mono tabular-nums">
                    {evalResult.bucket.toLocaleString()} / 100,000 ({(evalResult.bucket / 1000).toFixed(2)}%)
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Evaluation Duration</span>
                <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {evalResult.durationMicros} µs
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------- PAGE 11: VISUAL TARGETING RULES BUILDER ----------------
export function TargetingRulesPage({ selectedFlagId }: { selectedFlagId: number | null }) {
  const { selectedProject, selectedEnvironment, notify } = useAuth();
  const [flags, setFlags] = useState<FlagRecord[]>([]);
  const [activeFlagId, setActiveFlagId] = useState<number | null>(selectedFlagId);
  const [segments, setSegments] = useState<Array<{ key: string; name: string }>>([]);
  const [individualTargets, setIndividualTargets] = useState<Array<{ userKey: string; variationKey: string }>>([]);
  const [rules, setRules] = useState<TargetingRuleDef[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);

  const activeFlag = flags.find((f) => f.id === activeFlagId) || flags[0] || null;

  useEffect(() => {
    if (!selectedProject || !selectedEnvironment) return;
    Promise.all([
      api.get<{ data: FlagRecord[] }>(
        `/projects/${selectedProject.id}/flags?environmentId=${selectedEnvironment.id}`
      ),
      api.get<{ data: Array<{ key: string; name: string }> }>(
        `/projects/${selectedProject.id}/segments`
      ),
    ])
      .then(([flagRes, segRes]) => {
        setFlags(flagRes.data);
        setSegments(segRes.data);
        const target = flagRes.data.find((f) => f.id === (selectedFlagId || activeFlagId)) || flagRes.data[0];
        if (target) {
          setActiveFlagId(target.id);
        }
      })
      .catch(() => {});
  }, [selectedProject?.id, selectedEnvironment?.id]);

  useEffect(() => {
    if (!activeFlag) return;
    const targetsMap = activeFlag.envConfig?.individualTargets || {};
    setIndividualTargets(
      Object.entries(targetsMap).map(([userKey, variationKey]) => ({ userKey, variationKey }))
    );
    setRules(
      activeFlag.rules.map((r) => ({
        id: r.id,
        name: r.name,
        priority: r.priority,
        segmentKey: r.segmentKey,
        ruleGroup: (r.ruleGroup as unknown as RuleGroup) || { type: 'group', combinator: 'AND', children: [] },
        serveVariationKey: r.serveVariationKey,
        enabled: r.enabled,
      }))
    );
  }, [activeFlag?.id, selectedEnvironment?.id]);

  const addRule = () => {
    if (!activeFlag) return;
    const defaultVar = activeFlag.variations[1]?.variationKey || activeFlag.defaultVariationKey;
    setRules((prev) => [
      ...prev,
      {
        name: `Targeting Rule ${prev.length + 1}`,
        priority: prev.length + 1,
        segmentKey: null,
        serveVariationKey: defaultVar,
        enabled: true,
        ruleGroup: {
          type: 'group',
          combinator: 'AND',
          children: [{ type: 'condition', attribute: 'country', operator: 'EQUALS', value: 'US' }],
        },
      },
    ]);
  };

  const addConditionToRule = (ruleIdx: number) => {
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        return {
          ...r,
          ruleGroup: {
            ...r.ruleGroup,
            children: [
              ...r.ruleGroup.children,
              { type: 'condition', attribute: 'plan', operator: 'EQUALS', value: 'enterprise' },
            ],
          },
        };
      })
    );
  };

  const updateCondition = (
    ruleIdx: number,
    condIdx: number,
    patch: Partial<RuleCondition>
  ) => {
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        const children = r.ruleGroup.children.map((c, ci) =>
          ci === condIdx && c.type === 'condition' ? { ...c, ...patch } : c
        );
        return { ...r, ruleGroup: { ...r.ruleGroup, children } };
      })
    );
  };

  const removeCondition = (ruleIdx: number, condIdx: number) => {
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        return {
          ...r,
          ruleGroup: {
            ...r.ruleGroup,
            children: r.ruleGroup.children.filter((_, ci) => ci !== condIdx),
          },
        };
      })
    );
  };

  const handleSave = async () => {
    if (!activeFlag || !selectedEnvironment) return;
    setSaving(true);
    try {
      const targetObj: Record<string, string> = {};
      for (const row of individualTargets) {
        if (row.userKey.trim()) targetObj[row.userKey.trim()] = row.variationKey;
      }
      const res = await api.post<{ pendingApproval: boolean; message?: string }>(
        `/flags/${activeFlag.id}/environments/${selectedEnvironment.id}/config`,
        {
          individualTargets: targetObj,
          rules,
          changeReason: changeReason.trim() || `Updated targeting rules for ${activeFlag.key}`,
        }
      );
      if (res.pendingApproval) notify('info', 'Approval Required', res.message);
      else notify('success', 'Targeting rules saved and broadcast via SSE');
      setChangeReason('');
    } catch (err) {
      notify('error', 'Failed to save targeting rules', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Targeting Rules Builder</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Configure individual overrides, reusable segments, and AND/OR attribute rules with 12 operators.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="targeting-flag-select" className="sr-only">
            Select Feature Flag
          </label>
          <select
            id="targeting-flag-select"
            value={activeFlag?.id || ''}
            onChange={(e) => setActiveFlagId(Number(e.target.value))}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
          >
            {flags.map((f) => (
              <option key={f.id} value={f.id}>
                {f.key} ({f.flagType})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving || !activeFlag}
            onClick={() => void handleSave()}
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Targeting'}
          </button>
        </div>
      </div>

      {/* Step 2: Individual User Targeting */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">2. Individual User Targets</h2>
            <p className="text-xs text-slate-500">
              Evaluated immediately after the Kill Switch; overrides segments and percentage rollouts.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setIndividualTargets((prev) => [
                ...prev,
                {
                  userKey: '',
                  variationKey: activeFlag?.variations[1]?.variationKey || activeFlag?.defaultVariationKey || 'on',
                },
              ])
            }
            className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add User Target
          </button>
        </div>

        {individualTargets.length === 0 ? (
          <p className="text-xs text-slate-500">No individual user overrides configured.</p>
        ) : (
          <div className="space-y-2">
            {individualTargets.map((row, idx) => (
              <div key={idx} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <input
                  aria-label={`Target user key ${idx + 1}`}
                  value={row.userKey}
                  onChange={(e) =>
                    setIndividualTargets((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, userKey: e.target.value } : item))
                    )
                  }
                  placeholder="user-key (e.g. qa-alice)"
                  className="flex-1 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
                />
                <select
                  aria-label={`Target variation ${idx + 1}`}
                  value={row.variationKey}
                  onChange={(e) =>
                    setIndividualTargets((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, variationKey: e.target.value } : item))
                    )
                  }
                  className="w-44 h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                >
                  {(activeFlag?.variations || []).map((v) => (
                    <option key={v.variationKey} value={v.variationKey}>
                      Serve: {v.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Remove user target ${idx + 1}`}
                  onClick={() => setIndividualTargets((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-2 text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Step 3: Segment & Custom Attribute Rules */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">3. Segment & Attribute Targeting Rules</h2>
            <p className="text-xs text-slate-500">
              Rules evaluate top-to-bottom. Combine segment membership with nested AND/OR conditions.
            </p>
          </div>
          <button
            type="button"
            onClick={addRule}
            className="h-8 px-3 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Rule
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            No targeting rules yet. Click "Add Rule" to target by segment or user attributes.
          </p>
        ) : (
          <div className="space-y-4">
            {rules.map((rule, rIdx) => (
              <div
                key={rIdx}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 space-y-3"
              >
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex flex-wrap items-center gap-2 flex-1">
                    <span className="font-mono text-xs text-slate-500">#{rIdx + 1}</span>
                    <input
                      aria-label={`Rule ${rIdx + 1} name`}
                      value={rule.name}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((r, i) => (i === rIdx ? { ...r, name: e.target.value } : r))
                        )
                      }
                      className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium min-w-[200px]"
                    />
                    <select
                      aria-label={`Rule ${rIdx + 1} segment`}
                      value={rule.segmentKey || ''}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((r, i) =>
                            i === rIdx ? { ...r, segmentKey: e.target.value || null } : r
                          )
                        )
                      }
                      className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    >
                      <option value="">No segment (attributes only)</option>
                      {segments.map((s) => (
                        <option key={s.key} value={s.key}>
                          Segment: {s.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Rule ${rIdx + 1} combinator`}
                      value={rule.ruleGroup.combinator}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((r, i) =>
                            i === rIdx
                              ? { ...r, ruleGroup: { ...r.ruleGroup, combinator: e.target.value as 'AND' | 'OR' } }
                              : r
                          )
                        )
                      }
                      className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
                    >
                      <option value="AND">Match ALL (AND)</option>
                      <option value="OR">Match ANY (OR)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Rule ${rIdx + 1} variation`}
                      value={rule.serveVariationKey}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((r, i) =>
                            i === rIdx ? { ...r, serveVariationKey: e.target.value } : r
                          )
                        )
                      }
                      className="h-8 px-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-medium"
                    >
                      {(activeFlag?.variations || []).map((v) => (
                        <option key={v.variationKey} value={v.variationKey}>
                          Serve: {v.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Delete rule ${rIdx + 1}`}
                      onClick={() => setRules((prev) => prev.filter((_, i) => i !== rIdx))}
                      className="p-1.5 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Conditions List */}
                <div className="space-y-2 pl-4 border-l border-slate-200 dark:border-slate-800">
                  {rule.ruleGroup.children.map((child, cIdx) => {
                    if (child.type !== 'condition') return null;
                    return (
                      <div key={cIdx} className="grid sm:grid-cols-12 gap-2 items-center">
                        <input
                          aria-label={`Condition ${cIdx + 1} attribute`}
                          value={child.attribute}
                          onChange={(e) => updateCondition(rIdx, cIdx, { attribute: e.target.value })}
                          placeholder="attribute (e.g. country, appVersion)"
                          className="sm:col-span-3 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
                        />
                        <select
                          aria-label={`Condition ${cIdx + 1} operator`}
                          value={child.operator}
                          onChange={(e) =>
                            updateCondition(rIdx, cIdx, { operator: e.target.value as RuleOperator })
                          }
                          className="sm:col-span-4 h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          {ALL_OPERATORS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`Condition ${cIdx + 1} value`}
                          value={Array.isArray(child.value) ? child.value.join(', ') : child.value}
                          onChange={(e) => updateCondition(rIdx, cIdx, { value: e.target.value })}
                          placeholder="value"
                          className="sm:col-span-4 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
                        />
                        <button
                          type="button"
                          aria-label={`Remove condition ${cIdx + 1}`}
                          onClick={() => removeCondition(rIdx, cIdx)}
                          className="sm:col-span-1 p-1.5 text-slate-400 hover:text-red-600 justify-self-end"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => addConditionToRule(rIdx)}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Add Attribute Condition
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <input
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder="Change reason for version history / approval audit..."
            className="flex-1 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          />
          <button
            type="button"
            disabled={saving || !activeFlag}
            onClick={() => void handleSave()}
            className="h-9 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap"
          >
            {selectedEnvironment?.requiresApproval ? 'Submit for Approval' : 'Publish Targeting Rules'}
          </button>
        </div>
      </section>
    </div>
  );
}
