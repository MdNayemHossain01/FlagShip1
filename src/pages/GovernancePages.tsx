import React, { useEffect, useState } from 'react';
import { Check, RotateCcw, Search, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { ConfirmDialog } from '../components/Layout.tsx';
import type { FlagRecord } from './FlagsListFormPages.tsx';

interface ApprovalRow {
  id: number;
  flagKey: string;
  flagName: string;
  environmentName: string;
  requesterId: number | null;
  requesterName: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'SCHEDULED';
  requiredApprovals: number;
  approvers: Array<{
    userId: number;
    userName: string;
    decision: 'APPROVED' | 'REJECTED';
    comment: string;
    decidedAt: string;
  }>;
  reason: string;
  currentSnapshot: Record<string, unknown>;
  proposedChanges: Record<string, unknown>;
  scheduledFor: string | null;
  createdAt: string;
}

// ---------------- PAGE 14: APPROVAL REQUESTS PAGE ----------------
export function ApprovalsPage() {
  const { selectedProject, user, sseVersion, notify } = useAuth();
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentMap, setCommentMap] = useState<Record<number, string>>({});

  const loadApprovals = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await api.get<{ data: ApprovalRow[] }>(`/projects/${selectedProject.id}/approvals`);
      setApprovals(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadApprovals();
  }, [selectedProject?.id, sseVersion]);

  const handleDecision = async (id: number, decision: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await api.post<{ applied: boolean; scheduled?: boolean }>(`/approvals/${id}/decision`, {
        decision,
        comment: commentMap[id] || '',
      });
      if (decision === 'REJECTED') {
        notify('info', `Approval #${id} rejected`);
      } else if (res.applied) {
        notify('success', `Approval #${id} reached quorum and is now live in Production`);
      } else if (res.scheduled) {
        notify('success', `Approval #${id} reached quorum and is scheduled for rollout`);
      } else {
        notify('success', `Approval #${id} endorsed (awaiting second independent approver)`);
      }
      await loadApprovals();
    } catch (err) {
      notify('error', 'Decision blocked', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Production Approval Requests</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Two-person governance workflow. Production changes remain staged until independently approved.
        </p>
      </div>

      {loading ? (
        <div className="h-40 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
      ) : approvals.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
          No approval requests for {selectedProject?.name}.
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((req) => {
            const approvedCount = req.approvers.filter((a) => a.decision === 'APPROVED').length;
            const isSelf = req.requesterId === user?.id;
            return (
              <div
                key={req.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span>#{req.id} · {req.flagName}</span>
                      <span className="font-mono text-xs text-slate-500">({req.flagKey})</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Requested by {req.requesterName || 'Unknown'} · {req.environmentName} ·{' '}
                      {new Date(req.createdAt).toLocaleString()}
                      {req.scheduledFor ? ` · Scheduled for ${new Date(req.scheduledFor).toLocaleString()}` : ''}
                    </p>
                  </div>
                  <div className="text-xs font-mono font-semibold tabular-nums">
                    <span
                      className={
                        req.status === 'PENDING'
                          ? 'text-amber-600 dark:text-amber-400'
                          : req.status === 'APPLIED'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : req.status === 'SCHEDULED'
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {req.status} ({approvedCount}/{req.requiredApprovals} approvals)
                    </span>
                  </div>
                </div>

                <p className="text-sm text-slate-700 dark:text-slate-300">{req.reason}</p>

                {/* Before / After Diff View */}
                <div className="grid md:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                    <p className="text-[11px] font-sans font-semibold text-slate-500 mb-1.5">Current Live Config</p>
                    <pre className="overflow-x-auto text-slate-700 dark:text-slate-300">
                      {JSON.stringify(req.currentSnapshot, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                    <p className="text-[11px] font-sans font-semibold text-blue-700 dark:text-blue-400 mb-1.5">
                      Proposed Config
                    </p>
                    <pre className="overflow-x-auto text-slate-900 dark:text-slate-100">
                      {JSON.stringify(req.proposedChanges, null, 2)}
                    </pre>
                  </div>
                </div>

                {/* Review Trail */}
                {req.approvers.length > 0 && (
                  <div className="text-xs space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
                    {req.approvers.map((a, idx) => (
                      <p key={idx} className="text-slate-600 dark:text-slate-400">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{a.userName}</span>{' '}
                        {a.decision.toLowerCase()} on {new Date(a.decidedAt).toLocaleString()}
                        {a.comment ? ` — "${a.comment}"` : ''}
                      </p>
                    ))}
                  </div>
                )}

                {req.status === 'PENDING' && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <input
                      value={commentMap[req.id] || ''}
                      onChange={(e) => setCommentMap((prev) => ({ ...prev, [req.id]: e.target.value }))}
                      placeholder="Review note (optional)..."
                      className="flex-1 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDecision(req.id, 'REJECTED')}
                        className="h-9 px-3.5 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDecision(req.id, 'APPROVED')}
                        title={isSelf ? 'Two-person rule prevents self-approval' : 'Approve change'}
                        className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Approve ({approvedCount + 1}/{req.requiredApprovals})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- PAGE 15: VERSION HISTORY PAGE ----------------
interface VersionRow {
  id: number;
  versionNumber: number;
  changeReason: string;
  snapshotJson: Record<string, unknown>;
  diffJson: Record<string, unknown>;
  createdAt: string;
  authorName: string | null;
}

export function VersionHistoryPage() {
  const { selectedProject, selectedEnvironment, notify } = useAuth();
  const [flags, setFlags] = useState<FlagRecord[]>([]);
  const [selectedFlagId, setSelectedFlagId] = useState<number | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<VersionRow | null>(null);

  useEffect(() => {
    if (!selectedProject || !selectedEnvironment) return;
    api
      .get<{ data: FlagRecord[] }>(
        `/projects/${selectedProject.id}/flags?environmentId=${selectedEnvironment.id}`
      )
      .then((res) => {
        setFlags(res.data);
        if (res.data.length > 0) setSelectedFlagId((prev) => prev || res.data[0].id);
      })
      .catch(() => {});
  }, [selectedProject?.id, selectedEnvironment?.id]);

  const loadVersions = async () => {
    if (!selectedFlagId || !selectedEnvironment) return;
    const res = await api.get<{ data: VersionRow[] }>(
      `/flags/${selectedFlagId}/environments/${selectedEnvironment.id}/versions`
    );
    setVersions(res.data);
  };

  useEffect(() => {
    void loadVersions();
  }, [selectedFlagId, selectedEnvironment?.id]);

  const handleRestore = async () => {
    if (!restoreTarget || !selectedFlagId || !selectedEnvironment) return;
    try {
      await api.post(
        `/flags/${selectedFlagId}/environments/${selectedEnvironment.id}/restore/${restoreTarget.id}`
      );
      notify('success', `Restored configuration from version v${restoreTarget.versionNumber}`);
      await loadVersions();
    } catch (err) {
      notify('error', 'Restore failed', err instanceof Error ? err.message : undefined);
    } finally {
      setRestoreTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Version History</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Inspect immutable flag snapshots, configuration diffs, and restore any prior version.
          </p>
        </div>
        <select
          aria-label="Select flag for version history"
          value={selectedFlagId || ''}
          onChange={(e) => setSelectedFlagId(Number(e.target.value))}
          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
        >
          {flags.map((f) => (
            <option key={f.id} value={f.id}>
              {f.key}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {versions.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
            No recorded versions for this flag in {selectedEnvironment?.name}.
          </div>
        ) : (
          versions.map((v, idx) => (
            <div
              key={v.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">
                    v{v.versionNumber}
                  </span>
                  <span className="ml-2 text-sm font-medium">{v.changeReason}</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {v.authorName || 'System'} · {new Date(v.createdAt).toLocaleString()}
                  </p>
                </div>
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => setRestoreTarget(v)}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore v{v.versionNumber}
                  </button>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-3 text-xs font-mono">
                <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-x-auto">
                  {JSON.stringify(v.snapshotJson, null, 2)}
                </pre>
                <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-x-auto text-slate-600 dark:text-slate-400">
                  Diff: {JSON.stringify(v.diffJson, null, 2)}
                </pre>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title={`Restore Version v${restoreTarget?.versionNumber}`}
        message="This creates a new revision restoring the selected snapshot and broadcasts the update via SSE."
        confirmLabel="Restore Snapshot"
        onConfirm={() => void handleRestore()}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
}

// ---------------- PAGE 16: AUDIT LOGS PAGE ----------------
interface AuditRow {
  id: number;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  traceId: string;
  createdAt: string;
}

export function AuditLogsPage() {
  const { selectedProject, sseVersion } = useAuth();
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedProject) return;
    const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    api
      .get<{ data: AuditRow[] }>(`/projects/${selectedProject.id}/audit-logs${qs}`)
      .then((res) => setLogs(res.data))
      .catch(() => {});
  }, [selectedProject?.id, search, sseVersion]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Immutable compliance trail with distributed trace IDs and before/after state snapshots.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, flag, action, traceId..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 text-slate-500">
                <th className="py-3 px-4 font-medium">Timestamp</th>
                <th className="py-3 px-3 font-medium">Actor</th>
                <th className="py-3 px-3 font-medium">Action</th>
                <th className="py-3 px-3 font-medium">Summary</th>
                <th className="py-3 px-4 font-medium text-right">Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-900 dark:text-slate-100">
                      {log.actorName}
                    </td>
                    <td className="py-3 px-3 font-mono text-blue-600 dark:text-blue-400">
                      {log.action}
                    </td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300">{log.summary}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {expandedId === log.id ? 'Hide' : 'Inspect'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === log.id && (
                    <tr className="bg-slate-50 dark:bg-slate-950/60">
                      <td colSpan={5} className="p-4 space-y-2">
                        <p className="text-[11px] font-mono text-slate-500">Trace ID: {log.traceId}</p>
                        <div className="grid md:grid-cols-2 gap-3 text-[11px] font-mono">
                          <pre className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                            Before: {JSON.stringify(log.beforeState, null, 2)}
                          </pre>
                          <pre className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                            After: {JSON.stringify(log.afterState, null, 2)}
                          </pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
