import React, { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth, type ProjectItem } from '../context/AuthContext.tsx';
import { ConfirmDialog, type PageRoute } from '../components/Layout.tsx';
import type { UserRole } from '../core/types.ts';

// ---------------- PAGE 4: PROJECTS PAGE ----------------
export function ProjectsPage({
  onOpenProject,
}: {
  onOpenProject: (projectId: number) => void;
}) {
  const { projects, refreshProjects, notify, setSelectedProjectId } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectItem | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.post<ProjectItem>('/projects', { key, name, description });
      await refreshProjects();
      setSelectedProjectId(created.id);
      setKey('');
      setName('');
      setDescription('');
      setShowCreate(false);
      notify('success', `Project '${created.name}' created`, 'Development, Staging, and Production environments provisioned.');
    } catch (err) {
      notify('error', 'Failed to create project', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/projects/${deleteTarget.id}`);
      await refreshProjects();
      notify('success', `Deleted project '${deleteTarget.name}'`);
    } catch (err) {
      notify('error', 'Failed to delete project', err instanceof Error ? err.message : undefined);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Isolate feature flags, environments, SDK keys, and role-based access per product domain.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap self-start"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold">Create New Project</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="proj-name" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Project Name
              </label>
              <input
                id="proj-name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!key) {
                    setKey(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, '')
                    );
                  }
                }}
                placeholder="Payments Gateway"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label htmlFor="proj-key" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Unique Key (kebab-case)
              </label>
              <input
                id="proj-key"
                required
                pattern="[a-z0-9-]+"
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase())}
                placeholder="payments-gateway"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="proj-desc" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Description
            </label>
            <textarea
              id="proj-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe services and ownership for this project."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
            >
              {saving ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {projects.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">{p.name}</h2>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">{p.key}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(p)}
                  aria-label={`Delete project ${p.name}`}
                  className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-3 leading-relaxed">
                {p.description || 'No description provided.'}
              </p>
              <div className="mt-4 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                <span>{p.flagCount} flags</span>
                <span aria-hidden="true">·</span>
                <span>{p.environments.length} environments</span>
                <span aria-hidden="true">·</span>
                <span>{p.members.length} members</span>
              </div>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {p.environments.map((e) => e.name).join(' / ')}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectId(p.id);
                  onOpenProject(p.id);
                }}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                Manage Details
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Project"
        message={`Deleting '${deleteTarget?.name}' permanently removes all flags, targeting rules, environments, and experiment events inside it.`}
        confirmLabel="Delete Project"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------- PAGE 5: PROJECT DETAILS PAGE ----------------
export function ProjectDetailsPage({ onNavigate }: { onNavigate: (r: PageRoute) => void }) {
  const { selectedProject, refreshProjects, notify } = useAuth();
  const [name, setName] = useState(selectedProject?.name || '');
  const [description, setDescription] = useState(selectedProject?.description || '');
  const [allUsers, setAllUsers] = useState<Array<{ id: number; fullName: string; email: string }>>([]);
  const [memberUserId, setMemberUserId] = useState<number | ''>('');
  const [memberRole, setMemberRole] = useState<UserRole>('EDITOR');

  useEffect(() => {
    setName(selectedProject?.name || '');
    setDescription(selectedProject?.description || '');
  }, [selectedProject?.id]);

  useEffect(() => {
    api
      .get<{ data: Array<{ id: number; fullName: string; email: string }> }>('/users')
      .then((res) => setAllUsers(res.data))
      .catch(() => {});
  }, []);

  if (!selectedProject) return null;

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.put(`/projects/${selectedProject.id}`, { name, description });
      await refreshProjects();
      notify('success', 'Project details updated');
    } catch (err) {
      notify('error', 'Update failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleAssignMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberUserId) return;
    try {
      await api.post(`/projects/${selectedProject.id}/members`, {
        userId: Number(memberUserId),
        role: memberRole,
      });
      await refreshProjects();
      notify('success', 'Project role assigned');
    } catch (err) {
      notify('error', 'Role assignment failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleRotateKey = async (envId: number, envName: string) => {
    try {
      await api.post(`/environments/${envId}/rotate-key`);
      await refreshProjects();
      notify('success', `SDK key rotated for ${envName}`);
    } catch (err) {
      notify('error', 'Key rotation failed', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{selectedProject.name}</h1>
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
            Project key: {selectedProject.key}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('projects')}
          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
        >
          Back to Projects
        </button>
      </div>

      {/* General Settings */}
      <form
        onSubmit={handleSaveMeta}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold">Project Settings</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pd-name" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Project Name
            </label>
            <input
              id="pd-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label htmlFor="pd-desc" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Description
            </label>
            <input
              id="pd-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
          >
            Save Changes
          </button>
        </div>
      </form>

      {/* Project Members & RBAC */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold">Project Members & Roles</h2>
        </div>

        <form onSubmit={handleAssignMember} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="pm-user" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              User
            </label>
            <select
              id="pm-user"
              value={memberUserId}
              onChange={(e) => setMemberUserId(e.target.value ? Number(e.target.value) : '')}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="">Select user...</option>
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label htmlFor="pm-role" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Project Role
            </label>
            <select
              id="pm-role"
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as UserRole)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="ADMIN">Admin</option>
              <option value="EDITOR">Editor</option>
              <option value="APPROVER">Approver</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
          <button
            type="submit"
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
          >
            Assign Role
          </button>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 font-medium">Member</th>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium text-right">Assigned Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {selectedProject.members.map((m) => (
                <tr key={m.id}>
                  <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">{m.fullName}</td>
                  <td className="py-2.5 text-slate-500 dark:text-slate-400">{m.email}</td>
                  <td className="py-2.5 text-right font-mono font-semibold text-blue-600 dark:text-blue-400">
                    {m.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* SDK API Keys */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold">Environment SDK Keys</h2>
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {selectedProject.environments.map((env) => (
            <div key={env.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{env.name}</p>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5 break-all">
                  {env.sdkKeyPlainPreview}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(env.sdkKeyPlainPreview);
                    notify('info', `Copied ${env.name} SDK key`);
                  }}
                  className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => void handleRotateKey(env.id, env.name)}
                  className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Rotate Key
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------- PAGE 6: ENVIRONMENTS PAGE ----------------
export function EnvironmentsPage() {
  const { selectedProject, refreshProjects, notify } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [requiredApprovers, setRequiredApprovers] = useState(2);

  if (!selectedProject) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/projects/${selectedProject.id}/environments`, {
        name,
        key,
        requiresApproval,
        requiredApprovers,
      });
      await refreshProjects();
      setName('');
      setKey('');
      setShowAdd(false);
      notify('success', `Environment '${name}' created`);
    } catch (err) {
      notify('error', 'Failed to create environment', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Environments</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Configure isolation boundaries, SDK keys, and two-person approval requirements for {selectedProject.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 self-start"
        >
          <Plus className="h-4 w-4" />
          Add Environment
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold">New Environment</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="env-name" className="block text-xs font-medium mb-1">
                Environment Name
              </label>
              <input
                id="env-name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                }}
                placeholder="QA Sandbox"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label htmlFor="env-key" className="block text-xs font-medium mb-1">
                Key
              </label>
              <input
                id="env-key"
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="qa-sandbox"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="env-approvers" className="block text-xs font-medium mb-1">
                Required Approvers
              </label>
              <input
                id="env-approvers"
                type="number"
                min={1}
                max={5}
                value={requiredApprovers}
                onChange={(e) => setRequiredApprovers(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="rounded border-slate-300"
            />
            Require multi-person approval before changes become active
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-semibold"
            >
              Create Environment
            </button>
          </div>
        </form>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {selectedProject.environments.map((env) => (
          <div
            key={env.id}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">{env.name}</h2>
                <p className="text-xs font-mono text-slate-500">{env.key}</p>
              </div>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {env.requiresApproval ? `${env.requiredApprovers}-Person Gate` : 'Direct Publish'}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <p className="text-[11px] text-slate-500 mb-1">Server / Starter SDK Key</p>
              <p className="font-mono text-xs break-all text-slate-800 dark:text-slate-200">
                {env.sdkKeyPlainPreview}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(env.sdkKeyPlainPreview);
                  notify('info', `Copied ${env.name} SDK key`);
                }}
                className="flex-1 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Copy SDK Key
              </button>
              <button
                type="button"
                onClick={async () => {
                  await api.post(`/environments/${env.id}/rotate-key`);
                  await refreshProjects();
                  notify('success', `Rotated SDK key for ${env.name}`);
                }}
                className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Rotate
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
