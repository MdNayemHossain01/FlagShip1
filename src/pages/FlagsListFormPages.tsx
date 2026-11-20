import React, { useEffect, useState } from 'react';
import { AlertOctagon, Edit3, Eye, Plus, Power, Search, Sliders, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { ConfirmDialog, type PageRoute } from '../components/Layout.tsx';
import type { FlagType } from '../core/types.ts';

export interface FlagRecord {
  id: number;
  projectId: number;
  key: string;
  name: string;
  description: string;
  flagType: FlagType;
  ownerId: number | null;
  ownerName: string | null;
  defaultVariationKey: string;
  offVariationKey: string;
  tags: string[];
  archived: boolean;
  updatedAt: string;
  variations: Array<{
    id?: number;
    variationKey: string;
    name: string;
    value: unknown;
    description?: string;
  }>;
  envConfig: {
    id: number;
    environmentId: number;
    enabled: boolean;
    killSwitch: boolean;
    defaultVariationKey: string;
    rolloutVariationKey: string;
    rolloutPercentage: number;
    rolloutWeights: Array<{ variationKey: string; weight: number }>;
    individualTargets: Record<string, string>;
    version: number;
    evaluationCount: number;
    lastEvaluatedAt: string | null;
  } | null;
  rules: Array<{
    id: number;
    name: string;
    priority: number;
    segmentKey: string | null;
    ruleGroup: Record<string, unknown>;
    serveVariationKey: string;
    enabled: boolean;
  }>;
}

// ---------------- PAGE 7: FEATURE FLAGS PAGE ----------------
export function FeatureFlagsPage({
  globalSearch,
  onNavigate,
  onSelectFlag,
}: {
  globalSearch: string;
  onNavigate: (r: PageRoute) => void;
  onSelectFlag: (flag: FlagRecord, nextRoute: PageRoute) => void;
}) {
  const { selectedProject, selectedEnvironment, sseVersion, notify } = useAuth();
  const [flags, setFlags] = useState<FlagRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(globalSearch);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [killTarget, setKillTarget] = useState<FlagRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FlagRecord | null>(null);

  useEffect(() => {
    setSearch(globalSearch);
  }, [globalSearch]);

  const loadFlags = async () => {
    if (!selectedProject || !selectedEnvironment) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('environmentId', String(selectedEnvironment.id));
      if (search.trim()) qs.set('search', search.trim());
      if (typeFilter !== 'ALL') qs.set('flagType', typeFilter);
      const res = await api.get<{ data: FlagRecord[] }>(
        `/projects/${selectedProject.id}/flags?${qs.toString()}`
      );
      setFlags(res.data);
    } catch (err) {
      notify('error', 'Failed to load flags', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFlags();
  }, [selectedProject?.id, selectedEnvironment?.id, search, typeFilter, sseVersion]);

  const handleToggleEnabled = async (flag: FlagRecord) => {
    if (!selectedEnvironment || !flag.envConfig) return;
    try {
      const nextEnabled = !flag.envConfig.enabled;
      const res = await api.post<{ pendingApproval: boolean; message?: string }>(
        `/flags/${flag.id}/environments/${selectedEnvironment.id}/config`,
        {
          enabled: nextEnabled,
          killSwitch: false,
          changeReason: `${nextEnabled ? 'Enable' : 'Disable'} '${flag.key}' in ${selectedEnvironment.name}`,
        }
      );
      if (res.pendingApproval) {
        notify('info', 'Approval Required', res.message);
      } else {
        notify('success', `${flag.key} ${nextEnabled ? 'enabled' : 'disabled'}`);
      }
      await loadFlags();
    } catch (err) {
      notify('error', 'Toggle failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleKillSwitch = async () => {
    if (!killTarget || !selectedEnvironment || !killTarget.envConfig) return;
    try {
      const activating = !killTarget.envConfig.killSwitch;
      const res = await api.post<{ pendingApproval: boolean; message?: string }>(
        `/flags/${killTarget.id}/environments/${selectedEnvironment.id}/config`,
        {
          killSwitch: activating,
          changeReason: activating
            ? `Emergency kill switch activated on ${killTarget.key}`
            : `Clear kill switch on ${killTarget.key}`,
        }
      );
      if (res.pendingApproval) {
        notify('info', 'Approval Required', res.message);
      } else {
        notify(
          activating ? 'error' : 'success',
          activating ? `Kill switch activated for ${killTarget.key}` : `Kill switch cleared for ${killTarget.key}`
        );
      }
      await loadFlags();
    } catch (err) {
      notify('error', 'Kill switch failed', err instanceof Error ? err.message : undefined);
    } finally {
      setKillTarget(null);
    }
  };

  const handleDeleteFlag = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/flags/${deleteTarget.id}`);
      notify('success', `Deleted flag '${deleteTarget.key}'`);
      await loadFlags();
    } catch (err) {
      notify('error', 'Delete failed', err instanceof Error ? err.message : undefined);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            {selectedProject?.name} · {selectedEnvironment?.name}
            {selectedEnvironment?.requiresApproval
              ? ' (Production changes require 2-person approval; Kill Switch acts immediately)'
              : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('flag-create')}
          className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 self-start whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          Create Flag
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by key, name, or tag..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start">
          {(['ALL', 'BOOLEAN', 'STRING', 'NUMBER', 'JSON'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                typeFilter === t
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {t === 'ALL' ? 'All Types' : t}
            </button>
          ))}
        </div>
      </div>

      {/* Data Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-11 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : flags.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No feature flags match your filter.</p>
            <button
              type="button"
              onClick={() => onNavigate('flag-create')}
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-semibold"
            >
              Create Your First Flag
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-medium">Flag</th>
                  <th className="py-3 px-3 font-medium">Type</th>
                  <th className="py-3 px-3 font-medium">State</th>
                  <th className="py-3 px-3 font-medium">Rollout</th>
                  <th className="py-3 px-3 font-medium">Owner</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {flags.map((flag) => {
                  const cfg = flag.envConfig;
                  const pct = cfg?.rolloutPercentage ?? 0;
                  return (
                    <tr key={flag.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onSelectFlag(flag, 'flag-details')}
                          className="text-left group"
                        >
                          <p className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                            {flag.name}
                          </p>
                          <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {flag.key} · v{cfg?.version ?? 1} · {flag.rules.length} rules
                          </p>
                        </button>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                        {flag.flagType}
                      </td>
                      <td className="py-3 px-3">
                        {cfg?.killSwitch ? (
                          <span className="font-semibold text-red-600 dark:text-red-400">
                            Kill Switched
                          </span>
                        ) : cfg?.enabled ? (
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            Enabled
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">Disabled</span>
                        )}
                      </td>
                      <td className="py-3 px-3 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${
                                cfg?.killSwitch ? 'bg-red-500' : 'bg-blue-600'
                              }`}
                              style={{ width: `${cfg?.enabled && !cfg?.killSwitch ? pct : 0}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 w-9 text-right">
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                        {flag.ownerName || 'Unassigned'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void handleToggleEnabled(flag)}
                            aria-label={`${cfg?.enabled ? 'Disable' : 'Enable'} ${flag.key}`}
                            title={cfg?.enabled ? 'Disable flag' : 'Enable flag'}
                            className={`p-1.5 rounded-md border transition-colors ${
                              cfg?.enabled
                                ? 'border-emerald-200 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setKillTarget(flag)}
                            aria-label={`Kill switch ${flag.key}`}
                            title="Emergency Kill Switch"
                            className={`p-1.5 rounded-md border transition-colors ${
                              cfg?.killSwitch
                                ? 'border-red-500 bg-red-600 text-white'
                                : 'border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
                            }`}
                          >
                            <AlertOctagon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectFlag(flag, 'flag-details')}
                            aria-label={`View details for ${flag.key}`}
                            title="Details & Live Evaluator"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectFlag(flag, 'targeting')}
                            aria-label={`Targeting rules for ${flag.key}`}
                            title="Targeting Rules"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Sliders className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectFlag(flag, 'flag-edit')}
                            aria-label={`Edit ${flag.key}`}
                            title="Edit Flag"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(flag)}
                            aria-label={`Delete ${flag.key}`}
                            title="Delete Flag"
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(killTarget)}
        title={killTarget?.envConfig?.killSwitch ? 'Clear Kill Switch' : 'Activate Emergency Kill Switch'}
        message={
          killTarget?.envConfig?.killSwitch
            ? `Re-enable normal targeting and rollout rules for '${killTarget?.key}'?`
            : `Immediately force '${killTarget?.key}' to its off variation across all connected SDK instances via SSE (bypasses approval wait for safety).`
        }
        confirmLabel={killTarget?.envConfig?.killSwitch ? 'Clear Kill Switch' : 'Activate Kill Switch'}
        danger={!killTarget?.envConfig?.killSwitch}
        onConfirm={() => void handleKillSwitch()}
        onCancel={() => setKillTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Feature Flag"
        message={`Permanently delete '${deleteTarget?.key}' and all its targeting rules and version history?`}
        confirmLabel="Delete Flag"
        danger
        onConfirm={() => void handleDeleteFlag()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------- PAGES 8 & 9: CREATE & EDIT FLAG PAGES ----------------
interface VariationFormRow {
  variationKey: string;
  name: string;
  rawValue: string;
}

export function FlagFormPage({
  mode,
  initialFlag,
  onDone,
}: {
  mode: 'create' | 'edit';
  initialFlag?: FlagRecord | null;
  onDone: () => void;
}) {
  const { selectedProject, notify } = useAuth();
  const [name, setName] = useState(initialFlag?.name || '');
  const [key, setKey] = useState(initialFlag?.key || '');
  const [description, setDescription] = useState(initialFlag?.description || '');
  const [flagType, setFlagType] = useState<FlagType>(initialFlag?.flagType || 'BOOLEAN');
  const [tagsText, setTagsText] = useState((initialFlag?.tags || []).join(', '));
  const [variations, setVariations] = useState<VariationFormRow[]>(() => {
    if (initialFlag && initialFlag.variations.length >= 2) {
      return initialFlag.variations.map((v) => ({
        variationKey: v.variationKey,
        name: v.name,
        rawValue: typeof v.value === 'string' ? v.value : JSON.stringify(v.value),
      }));
    }
    return [
      { variationKey: 'off', name: 'Off (Control)', rawValue: 'false' },
      { variationKey: 'on', name: 'On (Enabled)', rawValue: 'true' },
    ];
  });
  const [defaultVariationKey, setDefaultVariationKey] = useState(
    initialFlag?.defaultVariationKey || 'off'
  );
  const [offVariationKey, setOffVariationKey] = useState(initialFlag?.offVariationKey || 'off');
  const [saving, setSaving] = useState(false);

  const handleTypeChange = (nextType: FlagType) => {
    setFlagType(nextType);
    if (mode === 'create') {
      if (nextType === 'BOOLEAN') {
        setVariations([
          { variationKey: 'off', name: 'Off', rawValue: 'false' },
          { variationKey: 'on', name: 'On', rawValue: 'true' },
        ]);
        setDefaultVariationKey('off');
        setOffVariationKey('off');
      } else if (nextType === 'STRING') {
        setVariations([
          { variationKey: 'control', name: 'Control Copy', rawValue: 'Buy Now' },
          { variationKey: 'variant-a', name: 'Variant A', rawValue: 'Complete Instant Order' },
        ]);
        setDefaultVariationKey('control');
        setOffVariationKey('control');
      } else if (nextType === 'NUMBER') {
        setVariations([
          { variationKey: 'standard', name: 'Standard Limit', rawValue: '25' },
          { variationKey: 'expanded', name: 'Expanded Limit', rawValue: '100' },
        ]);
        setDefaultVariationKey('standard');
        setOffVariationKey('standard');
      } else {
        setVariations([
          { variationKey: 'default', name: 'Default Config', rawValue: '{"maxRetries": 2, "timeoutMs": 1500}' },
          { variationKey: 'aggressive', name: 'High Throughput', rawValue: '{"maxRetries": 5, "timeoutMs": 3000}' },
        ]);
        setDefaultVariationKey('default');
        setOffVariationKey('default');
      }
    }
  };

  const parseValue = (raw: string): unknown => {
    if (flagType === 'BOOLEAN') return raw === 'true';
    if (flagType === 'NUMBER') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`Invalid number variation: '${raw}'`);
      return n;
    }
    if (flagType === 'JSON') {
      return JSON.parse(raw);
    }
    return raw;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    setSaving(true);
    try {
      const parsedVars = variations.map((v) => ({
        variationKey: v.variationKey.trim(),
        name: v.name.trim(),
        value: parseValue(v.rawValue),
      }));
      const tags = tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (mode === 'create') {
        await api.post(`/projects/${selectedProject.id}/flags`, {
          key: key.trim(),
          name: name.trim(),
          description: description.trim(),
          flagType,
          tags,
          defaultVariationKey,
          offVariationKey,
          variations: parsedVars,
        });
        notify('success', `Feature flag '${key}' created`);
      } else if (initialFlag) {
        await api.put(`/flags/${initialFlag.id}`, {
          name: name.trim(),
          description: description.trim(),
          tags,
          defaultVariationKey,
          offVariationKey,
          variations: parsedVars,
        });
        notify('success', `Feature flag '${initialFlag.key}' updated`);
      }
      onDone();
    } catch (err) {
      notify('error', 'Save failed', err instanceof Error ? err.message : 'Check variation values.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === 'create' ? 'Create Feature Flag' : `Edit Flag: ${initialFlag?.key}`}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Define typed variations, defaults, and metadata for {selectedProject?.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
        >
          Cancel
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="flag-name" className="block text-xs font-medium mb-1">
              Display Name
            </label>
            <input
              id="flag-name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (mode === 'create' && !key) {
                  setKey(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '')
                  );
                }
              }}
              placeholder="Smart Checkout v2"
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label htmlFor="flag-key" className="block text-xs font-medium mb-1">
              Unique Flag Key
            </label>
            <input
              id="flag-key"
              required
              disabled={mode === 'edit'}
              pattern="[a-z0-9-]+"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              placeholder="smart-checkout-v2"
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm disabled:opacity-60"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="flag-type" className="block text-xs font-medium mb-1">
              Flag Type
            </label>
            <select
              id="flag-type"
              disabled={mode === 'edit'}
              value={flagType}
              onChange={(e) => handleTypeChange(e.target.value as FlagType)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm disabled:opacity-60"
            >
              <option value="BOOLEAN">Boolean</option>
              <option value="STRING">String</option>
              <option value="NUMBER">Number</option>
              <option value="JSON">JSON</option>
            </select>
          </div>
          <div>
            <label htmlFor="flag-tags" className="block text-xs font-medium mb-1">
              Tags (comma separated)
            </label>
            <input
              id="flag-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="checkout, experiment, q4"
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="flag-desc" className="block text-xs font-medium mb-1">
            Description
          </label>
          <textarea
            id="flag-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explain the release purpose, rollback plan, and target metrics."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>

        {/* Named Variations */}
        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Named Variations ({flagType})
            </h2>
            {flagType !== 'BOOLEAN' && (
              <button
                type="button"
                onClick={() =>
                  setVariations((prev) => [
                    ...prev,
                    {
                      variationKey: `variant-${prev.length + 1}`,
                      name: `Variant ${prev.length + 1}`,
                      rawValue: flagType === 'NUMBER' ? '50' : flagType === 'JSON' ? '{}' : 'Value',
                    },
                  ])
                }
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                + Add Variation
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            {variations.map((v, idx) => (
              <div key={idx} className="grid sm:grid-cols-12 gap-2 items-center">
                <input
                  aria-label={`Variation ${idx + 1} key`}
                  required
                  value={v.variationKey}
                  onChange={(e) =>
                    setVariations((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, variationKey: e.target.value } : row))
                    )
                  }
                  placeholder="key"
                  className="sm:col-span-3 h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
                />
                <input
                  aria-label={`Variation ${idx + 1} name`}
                  required
                  value={v.name}
                  onChange={(e) =>
                    setVariations((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row))
                    )
                  }
                  placeholder="Label"
                  className="sm:col-span-4 h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                />
                {flagType === 'BOOLEAN' ? (
                  <select
                    aria-label={`Variation ${idx + 1} boolean value`}
                    value={v.rawValue}
                    onChange={(e) =>
                      setVariations((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, rawValue: e.target.value } : row))
                      )
                    }
                    className="sm:col-span-5 h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                ) : (
                  <input
                    aria-label={`Variation ${idx + 1} value`}
                    required
                    value={v.rawValue}
                    onChange={(e) =>
                      setVariations((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, rawValue: e.target.value } : row))
                      )
                    }
                    className="sm:col-span-5 h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Default & Off Variation Selectors */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="flag-default-var" className="block text-xs font-medium mb-1">
              Default Fallback Variation
            </label>
            <select
              id="flag-default-var"
              value={defaultVariationKey}
              onChange={(e) => setDefaultVariationKey(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              {variations.map((v) => (
                <option key={v.variationKey} value={v.variationKey}>
                  {v.name} ({v.variationKey})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="flag-off-var" className="block text-xs font-medium mb-1">
              Kill Switch / Disabled Variation
            </label>
            <select
              id="flag-off-var"
              value={offVariationKey}
              onChange={(e) => setOffVariationKey(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              {variations.map((v) => (
                <option key={v.variationKey} value={v.variationKey}>
                  {v.name} ({v.variationKey})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onDone}
            className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-9 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
          >
            {saving ? 'Saving...' : mode === 'create' ? 'Create Feature Flag' : 'Save Flag Updates'}
          </button>
        </div>
      </form>
    </div>
  );
}
