import React, { useEffect, useRef, useState } from 'react';
import { Copy, Play, Wifi, WifiOff } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { FlagShipClient, type ConnectionMode } from '../core/sdkClient.ts';
import type { EvaluationResult, UserRole } from '../core/types.ts';

interface UserRow {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  avatarInitials: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  projects: Array<{ projectId: number; projectName: string; role: UserRole }>;
}

// ---------------- PAGE 20: USER MANAGEMENT PAGE ----------------
export function UserManagementPage() {
  const { user: currentUser, notify } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [activity, setActivity] = useState<Array<{ id: number; action: string; summary: string; createdAt: string }>>([]);

  const loadUsers = async () => {
    const res = await api.get<{ data: UserRow[] }>('/users');
    setUsers(res.data);
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    if (!selectedUserId) return;
    api
      .get<{ data: Array<{ id: number; action: string; summary: string; createdAt: string }> }>(
        `/users/${selectedUserId}/activity`
      )
      .then((res) => setActivity(res.data))
      .catch(() => {});
  }, [selectedUserId]);

  const handleRoleChange = async (id: number, role: UserRole) => {
    try {
      await api.patch(`/users/${id}`, { role });
      notify('success', `Updated user role to ${role}`);
      await loadUsers();
    } catch (err) {
      notify('error', 'Role update blocked', err instanceof Error ? err.message : undefined);
    }
  };

  const handleToggleActive = async (row: UserRow) => {
    try {
      await api.patch(`/users/${row.id}`, { active: !row.active });
      notify('success', `${row.fullName} ${!row.active ? 'activated' : 'deactivated'}`);
      await loadUsers();
    } catch (err) {
      notify('error', 'Status update failed', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Manage platform accounts, role-based access control (Admin, Editor, Approver, Viewer), and user activity history.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 text-slate-500">
                <th className="py-3 px-4 font-medium">User</th>
                <th className="py-3 px-3 font-medium">Global Role</th>
                <th className="py-3 px-3 font-medium">Project Access</th>
                <th className="py-3 px-3 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{row.fullName}</p>
                    <p className="text-slate-500">{row.email}</p>
                  </td>
                  <td className="py-3 px-3">
                    <select
                      aria-label={`Role for ${row.fullName}`}
                      disabled={currentUser?.role !== 'ADMIN' || row.id === currentUser?.id}
                      value={row.role}
                      onChange={(e) => void handleRoleChange(row.id, e.target.value as UserRole)}
                      className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs disabled:opacity-60"
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="EDITOR">EDITOR</option>
                      <option value="APPROVER">APPROVER</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  </td>
                  <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                    {row.projects.map((p) => `${p.projectName} (${p.role})`).join(', ') || 'None'}
                  </td>
                  <td className="py-3 px-3">
                    <button
                      type="button"
                      disabled={currentUser?.role !== 'ADMIN' || row.id === currentUser?.id}
                      onClick={() => void handleToggleActive(row)}
                      className={`text-xs font-semibold ${
                        row.active
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      } disabled:opacity-60`}
                    >
                      {row.active ? 'Active' : 'Suspended'}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedUserId(selectedUserId === row.id ? null : row.id)}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {selectedUserId === row.id ? 'Hide History' : 'View History'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUserId && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <h2 className="text-sm font-semibold">
            Activity History for {users.find((u) => u.id === selectedUserId)?.fullName}
          </h2>
          {activity.length === 0 ? (
            <p className="text-xs text-slate-500">No recorded audit events for this user.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {activity.map((a) => (
                <li key={a.id} className="py-2.5 flex items-center justify-between gap-4">
                  <span>
                    <span className="font-mono text-blue-600 dark:text-blue-400 mr-2">{a.action}</span>
                    {a.summary}
                  </span>
                  <span className="font-mono text-slate-500 tabular-nums whitespace-nowrap">
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------- PAGE 21: SETTINGS, SDK QUICKSTART & OFFLINE RESILIENCE SIMULATOR ----------------
export function SettingsPage() {
  const { selectedEnvironment, notify } = useAuth();
  const sdkRef = useRef<FlagShipClient | null>(null);
  const [sdkMode, setSdkMode] = useState<ConnectionMode>('CONNECTING');
  const [offlineSim, setOfflineSim] = useState(false);
  const [cachedFlagCount, setCachedFlagCount] = useState(0);
  const [simFlagKey, setSimFlagKey] = useState('new-checkout');
  const [simUserKey, setSimUserKey] = useState('qa-alice');
  const [simResult, setSimResult] = useState<EvaluationResult | null>(null);

  useEffect(() => {
    if (!selectedEnvironment) return;
    const client = new FlagShipClient({
      baseUrl: window.location.origin,
      sdkKey: selectedEnvironment.sdkKeyPlainPreview,
      onStatusChange: (m) => setSdkMode(m),
      onSnapshotUpdate: (snap) => setCachedFlagCount(Object.keys(snap.flags).length),
    });
    sdkRef.current = client;
    setOfflineSim(false);
    void client.initialize();
    return () => {
      client.close();
      sdkRef.current = null;
    };
  }, [selectedEnvironment?.id]);

  const toggleOfflineSimulation = () => {
    const next = !offlineSim;
    setOfflineSim(next);
    sdkRef.current?.setSimulatedOffline(next);
    notify(
      next ? 'info' : 'success',
      next ? 'Simulated server outage enabled' : 'Reconnecting SDK to live SSE stream',
      next ? 'Local snapshot evaluation remains active with zero exceptions.' : undefined
    );
  };

  const runLocalSdkEval = () => {
    if (!sdkRef.current) return;
    const result = sdkRef.current.evaluate(simFlagKey, { userKey: simUserKey, attributes: { country: 'US' } }, false);
    setSimResult(result);
  };

  const springSnippet = `// 1. Add FlagShip Spring Boot Starter to pom.xml
<dependency>
  <groupId>com.flagship</groupId>
  <artifactId>flagship-spring-boot-starter</artifactId>
  <version>1.0.0</version>
</dependency>

// 2. application.yml
flagship:
  server-url: ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080'}
  sdk-key: ${selectedEnvironment?.sdkKeyPlainPreview || 'fs_prod_...'}
  snapshot-file: ./flagship-snapshot.json
  startup-timeout-ms: 1500

// 3. Guard any Spring Bean method with @FeatureEnabled
@Service
public class CheckoutService {
    @FeatureEnabled(value = "new-checkout", fallbackMethod = "legacyCheckout")
    public Receipt processOrder(String userKey) {
        return expressCheckout(userKey);
    }
}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings & SDK Integration</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Integrate the FlagShip Java Spring Boot Starter or TypeScript SDK and test live SSE + offline resilience.
        </p>
      </div>

      {/* Live SDK & Offline Resilience Tester */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Live Client SDK & Offline Resilience Simulator</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Connection mode: <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{sdkMode}</span> ·{' '}
              Cached snapshot flags: <span className="font-mono tabular-nums">{cachedFlagCount}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={toggleOfflineSimulation}
            className={`h-9 px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
              offlineSim
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {offlineSim ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {offlineSim ? 'Restore Server Connection' : 'Simulate Server Outage'}
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <div>
            <label htmlFor="sim-flag" className="block text-xs font-medium mb-1">
              Flag Key
            </label>
            <input
              id="sim-flag"
              value={simFlagKey}
              onChange={(e) => setSimFlagKey(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
            />
          </div>
          <div>
            <label htmlFor="sim-user" className="block text-xs font-medium mb-1">
              User Key
            </label>
            <input
              id="sim-user"
              value={simUserKey}
              onChange={(e) => setSimUserKey(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs"
            />
          </div>
          <button
            type="button"
            onClick={runLocalSdkEval}
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            Evaluate Locally (0 Network Hops)
          </button>
        </div>

        {simResult && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3.5 text-xs font-mono flex flex-wrap gap-x-6 gap-y-1">
            <span>Variation: <strong>{simResult.variationKey}</strong></span>
            <span>Value: <strong>{JSON.stringify(simResult.value)}</strong></span>
            <span>Reason: <strong>{simResult.reason}</strong></span>
            <span>Local Latency: <strong className="text-emerald-600 dark:text-emerald-400">{simResult.durationMicros} µs</strong></span>
          </div>
        )}
      </section>

      {/* Spring Boot Starter Quick Start */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Spring Boot 4 Starter Quick Start</h2>
            <p className="text-xs text-slate-500">
              Active Environment: {selectedEnvironment?.name} ({selectedEnvironment?.key})
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(springSnippet);
              notify('info', 'Copied Spring Boot Starter snippet');
            }}
            className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy Snippet
          </button>
        </div>
        <pre className="p-4 rounded-lg bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
          {springSnippet}
        </pre>
      </section>
    </div>
  );
}

// ---------------- PAGE 22: PROFILE & PASSWORD PAGE ----------------
export function ProfilePage() {
  const { user, updateLocalUser, notify } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  if (!user) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await api.patch<{ user: typeof user }>('/auth/profile', { fullName });
      updateLocalUser(res.user);
      notify('success', 'Profile name updated');
    } catch (err) {
      notify('error', 'Profile update failed', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPwd(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      notify('success', 'Password changed successfully');
    } catch (err) {
      notify('error', 'Password change failed', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile & Security</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          Manage your FlagShip identity, workspace role, and password credentials.
        </p>
      </div>

      <form
        onSubmit={handleSaveProfile}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
      >
        <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="h-11 w-11 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center">
            {user.avatarInitials}
          </div>
          <div>
            <p className="text-sm font-semibold">{user.fullName}</p>
            <p className="text-xs text-slate-500">
              {user.email} · Role: <span className="font-mono font-semibold">{user.role}</span>
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="prof-name" className="block text-xs font-medium mb-1">
            Full Name
          </label>
          <input
            id="prof-name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingProfile}
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
          >
            {savingProfile ? 'Saving...' : 'Update Profile'}
          </button>
        </div>
      </form>

      <form
        onSubmit={handleChangePassword}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold">Change Password</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pwd-curr" className="block text-xs font-medium mb-1">
              Current Password
            </label>
            <input
              id="pwd-curr"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label htmlFor="pwd-new" className="block text-xs font-medium mb-1">
              New Password (min 8 chars)
            </label>
            <input
              id="pwd-new"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingPwd}
            className="h-9 px-4 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold"
          >
            {savingPwd ? 'Updating...' : 'Change Password'}
          </button>
        </div>
      </form>
    </div>
  );
}
