import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { computeRolloutBucket } from '../core/evaluator.ts';
import type { FlagRecord } from './FlagsListFormPages.tsx';
import type { RuleOperator } from '../core/types.ts';

interface SegmentRow {
  id: number;
  key: string;
  name: string;
  description: string;
  includedUsers: string[];
  excludedUsers: string[];
  ruleGroup: {
    type: 'group';
    combinator: 'AND' | 'OR';
    children: Array<{ type: 'condition'; attribute: string; operator: RuleOperator; value: string | string[] }>;
  };
}

// ---------------- PAGE 12: SEGMENTS PAGE ----------------
export function SegmentsPage() {
  const { selectedProject, notify } = useAuth();
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [includedText, setIncludedText] = useState('');
  const [excludedText, setExcludedText] = useState('');
  const [attr, setAttr] = useState('country');
  const [op, setOp] = useState<RuleOperator>('IN');
  const [val, setVal] = useState('US, CA');

  const loadSegments = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await api.get<{ data: SegmentRow[] }>(`/projects/${selectedProject.id}/segments`);
      setSegments(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSegments();
  }, [selectedProject?.id]);

  const openCreate = () => {
    setEditingId(null);
    setKey('');
    setName('');
    setDescription('');
    setIncludedText('');
    setExcludedText('');
    setAttr('country');
    setOp('IN');
    setVal('US, CA');
    setShowForm(true);
  };

  const openEdit = (seg: SegmentRow) => {
    setEditingId(seg.id);
    setKey(seg.key);
    setName(seg.name);
    setDescription(seg.description);
    setIncludedText((seg.includedUsers || []).join(', '));
    setExcludedText((seg.excludedUsers || []).join(', '));
    const firstCond = seg.ruleGroup?.children?.[0];
    if (firstCond) {
      setAttr(firstCond.attribute);
      setOp(firstCond.operator);
      setVal(Array.isArray(firstCond.value) ? firstCond.value.join(', ') : String(firstCond.value));
    }
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    const payload = {
      key: key.trim(),
      name: name.trim(),
      description: description.trim(),
      includedUsers: includedText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      excludedUsers: excludedText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ruleGroup: {
        type: 'group',
        combinator: 'AND',
        children: [{ type: 'condition', attribute: attr.trim(), operator: op, value: val.trim() }],
      },
    };
    try {
      if (editingId) {
        await api.put(`/segments/${editingId}`, payload);
        notify('success', `Segment '${name}' updated`);
      } else {
        await api.post(`/projects/${selectedProject.id}/segments`, payload);
        notify('success', `Segment '${name}' created`);
      }
      setShowForm(false);
      await loadSegments();
    } catch (err) {
      notify('error', 'Failed to save segment', err instanceof Error ? err.message : undefined);
    }
  };

  const handleDelete = async (id: number, segName: string) => {
    try {
      await api.delete(`/segments/${id}`);
      notify('success', `Deleted segment '${segName}'`);
      await loadSegments();
    } catch (err) {
      notify('error', 'Delete failed', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Segments</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Define reusable user cohorts once and reference them across multiple feature flag targeting rules.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 self-start"
        >
          <Plus className="h-4 w-4" />
          Create Segment
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSave}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold">{editingId ? 'Edit Segment' : 'New Segment'}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="seg-name" className="block text-xs font-medium mb-1">
                Segment Name
              </label>
              <input
                id="seg-name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!editingId && !key) {
                    setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                  }
                }}
                placeholder="Enterprise Early Access"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label htmlFor="seg-key" className="block text-xs font-medium mb-1">
                Segment Key
              </label>
              <input
                id="seg-key"
                required
                disabled={Boolean(editingId)}
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase())}
                placeholder="enterprise-early-access"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm disabled:opacity-60"
              />
            </div>
          </div>
          <div>
            <label htmlFor="seg-desc" className="block text-xs font-medium mb-1">
              Description
            </label>
            <input
              id="seg-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="seg-attr" className="block text-xs font-medium mb-1">
                Rule Attribute
              </label>
              <input
                id="seg-attr"
                value={attr}
                onChange={(e) => setAttr(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
              />
            </div>
            <div>
              <label htmlFor="seg-op" className="block text-xs font-medium mb-1">
                Operator
              </label>
              <select
                id="seg-op"
                value={op}
                onChange={(e) => setOp(e.target.value as RuleOperator)}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              >
                <option value="EQUALS">Equals</option>
                <option value="IN">In</option>
                <option value="ENDS_WITH">Ends With</option>
                <option value="CONTAINS">Contains</option>
                <option value="SEMVER_GT">SemVer Greater Than</option>
                <option value="REGEX">Regex</option>
              </select>
            </div>
            <div>
              <label htmlFor="seg-val" className="block text-xs font-medium mb-1">
                Target Value
              </label>
              <input
                id="seg-val"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="seg-inc" className="block text-xs font-medium mb-1">
                Always Included User Keys (comma separated)
              </label>
              <input
                id="seg-inc"
                value={includedText}
                onChange={(e) => setIncludedText(e.target.value)}
                placeholder="qa-alice, pm-aria"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
              />
            </div>
            <div>
              <label htmlFor="seg-exc" className="block text-xs font-medium mb-1">
                Always Excluded User Keys (comma separated)
              </label>
              <input
                id="seg-exc"
                value={excludedText}
                onChange={(e) => setExcludedText(e.target.value)}
                placeholder="blocked-bot-01"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-semibold"
            >
              Save Segment
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-32 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {segments.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{s.name}</h2>
                  <p className="text-xs font-mono text-slate-500">{s.key}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    className="h-7 px-2.5 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete segment ${s.name}`}
                    onClick={() => void handleDelete(s.id, s.name)}
                    className="p-1.5 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">{s.description}</p>
              <div className="text-xs text-slate-500 space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
                <p>
                  Included: <span className="font-mono">{s.includedUsers.join(', ') || 'None'}</span>
                </p>
                <p>
                  Excluded: <span className="font-mono">{s.excludedUsers.join(', ') || 'None'}</span>
                </p>
                <p>
                  Conditions: <span className="font-mono">{s.ruleGroup?.children?.length || 0} rules ({s.ruleGroup?.combinator})</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- PAGE 13: GRADUAL ROLLOUT MANAGEMENT ----------------
const ROLLOUT_PRESETS = [0, 5, 10, 20, 50, 75, 100];

export function RolloutManagementPage({ selectedFlagId }: { selectedFlagId: number | null }) {
  const { selectedProject, selectedEnvironment, sseVersion, notify } = useAuth();
  const [flags, setFlags] = useState<FlagRecord[]>([]);
  const [activeFlagId, setActiveFlagId] = useState<number | null>(selectedFlagId);
  const [percentage, setPercentage] = useState(20);
  const [rolloutVarKey, setRolloutVarKey] = useState('on');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const activeFlag = flags.find((f) => f.id === activeFlagId) || flags[0] || null;

  useEffect(() => {
    if (!selectedProject || !selectedEnvironment) return;
    api
      .get<{ data: FlagRecord[] }>(
        `/projects/${selectedProject.id}/flags?environmentId=${selectedEnvironment.id}`
      )
      .then((res) => {
        setFlags(res.data);
        const found = res.data.find((f) => f.id === (selectedFlagId || activeFlagId)) || res.data[0];
        if (found) {
          setActiveFlagId(found.id);
          setPercentage(found.envConfig?.rolloutPercentage ?? 0);
          setRolloutVarKey(found.envConfig?.rolloutVariationKey || found.variations[1]?.variationKey || 'on');
        }
      })
      .catch(() => {});
  }, [selectedProject?.id, selectedEnvironment?.id, sseVersion]);

  useEffect(() => {
    if (activeFlag?.envConfig) {
      setPercentage(activeFlag.envConfig.rolloutPercentage);
      setRolloutVarKey(activeFlag.envConfig.rolloutVariationKey);
    }
  }, [activeFlag?.id]);

  // Deterministic Cohort Retention Verification (100 simulated user keys)
  const simulation = useMemo(() => {
    const flagKey = activeFlag?.key || 'new-checkout';
    const sample = Array.from({ length: 100 }, (_, i) => {
      const userKey = `customer-${1000 + i}`;
      const bucket = computeRolloutBucket(flagKey, userKey);
      return {
        userKey,
        bucket,
        in10: bucket < 10000,
        in20: bucket < 20000,
        inSelected: bucket < percentage * 1000,
      };
    });
    const count10 = sample.filter((u) => u.in10).length;
    const retained10In20 = sample.filter((u) => u.in10 && u.in20).length;
    const countSelected = sample.filter((u) => u.inSelected).length;
    return { sample, count10, retained10In20, countSelected };
  }, [activeFlag?.key, percentage]);

  const handleApplyRollout = async () => {
    if (!activeFlag || !selectedEnvironment) return;
    setSaving(true);
    try {
      const res = await api.post<{ pendingApproval: boolean; message?: string }>(
        `/flags/${activeFlag.id}/environments/${selectedEnvironment.id}/config`,
        {
          enabled: percentage > 0 ? true : activeFlag.envConfig?.enabled,
          rolloutPercentage: percentage,
          rolloutVariationKey: rolloutVarKey,
          changeReason: reason.trim() || `Adjusted gradual rollout for ${activeFlag.key} to ${percentage}%`,
        }
      );
      if (res.pendingApproval) notify('info', 'Production Approval Queued', res.message);
      else notify('success', `Rollout updated to ${percentage}% and pushed via SSE`);
      setReason('');
    } catch (err) {
      notify('error', 'Rollout update failed', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gradual Rollout Manager</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Release features progressively with deterministic MurmurHash3 bucketing across instances.
          </p>
        </div>
        <select
          aria-label="Select flag for rollout"
          value={activeFlag?.id || ''}
          onChange={(e) => setActiveFlagId(Number(e.target.value))}
          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
        >
          {flags.map((f) => (
            <option key={f.id} value={f.id}>
              {f.key} ({f.envConfig?.rolloutPercentage ?? 0}%)
            </option>
          ))}
        </select>
      </div>

      {/* Rollout Control Card */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{activeFlag?.name || 'Select a Flag'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Environment: {selectedEnvironment?.name} · Current live exposure: {activeFlag?.envConfig?.rolloutPercentage ?? 0}%
            </p>
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {percentage}%
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className="space-y-2">
          <div className="h-3 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-[width] duration-200"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={percentage}
            aria-label="Rollout percentage slider"
            onChange={(e) => setPercentage(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
        </div>

        {/* Standard Rollout Presets */}
        <div className="flex flex-wrap items-center gap-2">
          {ROLLOUT_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPercentage(p)}
              className={`h-8 px-3 rounded-lg text-xs font-mono font-semibold border transition-colors ${
                percentage === p
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {p}%
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-4 pt-2">
          <div>
            <label htmlFor="rollout-var" className="block text-xs font-medium mb-1">
              Target Variation Served to Rollout Cohort
            </label>
            <select
              id="rollout-var"
              value={rolloutVarKey}
              onChange={(e) => setRolloutVarKey(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              {(activeFlag?.variations || []).map((v) => (
                <option key={v.variationKey} value={v.variationKey}>
                  {v.name} ({v.variationKey})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rollout-reason" className="block text-xs font-medium mb-1">
              Change Reason
            </label>
            <input
              id="rollout-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Expand canary from 10% to 20% after 24h error-free soak"
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving || !activeFlag}
            onClick={() => void handleApplyRollout()}
            className="h-9 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {selectedEnvironment?.requiresApproval ? 'Submit Rollout for Approval' : 'Apply Rollout Immediately'}
          </button>
        </div>
      </section>

      {/* Deterministic Cohort Monotonicity Visualizer */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Deterministic Cohort Consistency Matrix (100 Sample Users)</h2>
            <p className="text-xs text-slate-500">
              Bucket = MurmurHash3_32("{activeFlag?.key || 'flag'}:userKey") mod 100,000. Users in the blue cells receive '{rolloutVarKey}' at {percentage}%.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            10% → 20% Retention: {simulation.retained10In20}/{simulation.count10} (100%)
          </div>
        </div>

        <div className="grid grid-cols-10 gap-1.5">
          {simulation.sample.map((u) => (
            <div
              key={u.userKey}
              title={`${u.userKey} · bucket ${u.bucket} (${(u.bucket / 1000).toFixed(1)}%)`}
              className={`h-7 rounded text-[10px] font-mono flex items-center justify-center tabular-nums transition-colors ${
                u.inSelected
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              {(u.bucket / 1000).toFixed(0)}%
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
