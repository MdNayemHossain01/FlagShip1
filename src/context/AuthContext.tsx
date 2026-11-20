import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import type { UserRole } from '../core/types.ts';

export interface UserProfile {
  id: number;
  uid: string | null;
  email: string;
  fullName: string;
  role: UserRole;
  avatarInitials: string;
}

export interface EnvironmentItem {
  id: number;
  projectId: number;
  key: string;
  name: string;
  color: string;
  requiresApproval: boolean;
  requiredApprovers: number;
  sdkKeyPrefix: string;
  sdkKeyPlainPreview: string;
}

export interface ProjectItem {
  id: number;
  key: string;
  name: string;
  description: string;
  flagCount: number;
  environments: EnvironmentItem[];
  members: Array<{
    id: number;
    userId: number;
    role: UserRole;
    fullName: string;
    email: string;
    avatarInitials: string;
  }>;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

export interface LiveNotification {
  id: string;
  event: string;
  summary: string;
  timestamp: string;
}

export type SseStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  projects: ProjectItem[];
  selectedProject: ProjectItem | null;
  selectedEnvironment: EnvironmentItem | null;
  setSelectedProjectId: (id: number, preferredEnvId?: number) => void;
  setSelectedEnvironmentId: (id: number) => void;
  refreshProjects: (override?: { projectId?: number; environmentId?: number }) => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  registerAccount: (fullName: string, email: string, password: string, role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
  updateLocalUser: (u: UserProfile) => void;
  sseStatus: SseStatus;
  sseVersion: number;
  notifications: LiveNotification[];
  clearNotifications: () => void;
  toasts: ToastMessage[];
  notify: (type: ToastMessage['type'], title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<number | null>(null);
  const [selectedEnvironmentId, setSelectedEnvironmentIdState] = useState<number | null>(null);
  const selectedProjectIdRef = useRef<number | null>(null);
  const selectedEnvironmentIdRef = useRef<number | null>(null);
  const [sseStatus, setSseStatus] = useState<SseStatus>('DISCONNECTED');
  const [sseVersion, setSseVersion] = useState(0);
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const notify = useCallback((type: ToastMessage['type'], title: string, detail?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, title, detail }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshProjects = useCallback(
    async (override?: { projectId?: number; environmentId?: number }) => {
      try {
        const res = await api.get<{ data: ProjectItem[] }>('/projects');
        setProjects(res.data);
        if (res.data.length > 0) {
          const desiredProjId = override?.projectId ?? selectedProjectIdRef.current;
          const nextProj = res.data.find((p) => p.id === desiredProjId) || res.data[0];

          const desiredEnvId = override?.environmentId ?? selectedEnvironmentIdRef.current;
          const validEnv = nextProj.environments.find((e) => e.id === desiredEnvId);
          const prod = nextProj.environments.find((e) => e.key === 'production');
          const nextEnvId = validEnv?.id || prod?.id || nextProj.environments[0]?.id || null;

          selectedProjectIdRef.current = nextProj.id;
          selectedEnvironmentIdRef.current = nextEnvId;
          setSelectedProjectIdState(nextProj.id);
          setSelectedEnvironmentIdState(nextEnvId);
        }
      } catch (err) {
        console.error('Failed to load projects:', err);
      }
    },
    []
  );

  // Bootstrap session from existing local JWT
  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const token = await api.getActiveBearerToken();
        if (token) {
          const res = await api.get<{ user: UserProfile }>('/auth/me');
          if (active) {
            setUser(res.user);
            await refreshProjects();
          }
        }
      } catch {
        api.setTokens(null, null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void init();

    return () => {
      active = false;
    };
  }, [refreshProjects]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  const selectedEnvironment =
    selectedProject?.environments.find((e) => e.id === selectedEnvironmentId) ||
    selectedProject?.environments[0] ||
    null;

  const setSelectedProjectId = (id: number, preferredEnvId?: number) => {
    selectedProjectIdRef.current = id;
    setSelectedProjectIdState(id);
    if (preferredEnvId) {
      selectedEnvironmentIdRef.current = preferredEnvId;
      setSelectedEnvironmentIdState(preferredEnvId);
      return;
    }
    const proj = projects.find((p) => p.id === id);
    if (proj) {
      const prod = proj.environments.find((e) => e.key === 'production');
      const nextEnvId = prod?.id || proj.environments[0]?.id || null;
      selectedEnvironmentIdRef.current = nextEnvId;
      setSelectedEnvironmentIdState(nextEnvId);
    }
  };

  const setSelectedEnvironmentId = (id: number) => {
    selectedEnvironmentIdRef.current = id;
    setSelectedEnvironmentIdState(id);
  };

  // Real-time Server-Sent Events subscription
  useEffect(() => {
    if (!user || !selectedProject) {
      setSseStatus('DISCONNECTED');
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const connect = async () => {
      const token = await api.getActiveBearerToken();
      if (!token || cancelled) return;

      if (esRef.current) {
        esRef.current.close();
      }
      const url = `/api/stream?projectId=${selectedProject.id}&token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('connected', () => {
        if (!cancelled) setSseStatus('CONNECTED');
      });

      const handleUpdate = (eventName: string, ev: MessageEvent) => {
        if (cancelled) return;
        setSseVersion((v) => v + 1);
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          const label =
            eventName === 'flag:killswitch'
              ? `Emergency kill switch activated on ${String(data.flagKey || 'flag')}`
              : eventName === 'approval:updated'
                ? `Approval workflow updated for ${String(data.flagKey || 'flag')}`
                : `Configuration synced for ${String(data.flagKey || data.segmentKey || 'project')}`;
          setNotifications((prev) => [
            {
              id: String(data.eventId || Date.now()),
              event: eventName,
              summary: label,
              timestamp: new Date().toLocaleTimeString(),
            },
            ...prev.slice(0, 19),
          ]);
        } catch {
          // Ignore malformed event
        }
      };

      es.addEventListener('flag:updated', (e) => handleUpdate('flag:updated', e as MessageEvent));
      es.addEventListener('flag:killswitch', (e) => handleUpdate('flag:killswitch', e as MessageEvent));
      es.addEventListener('approval:updated', (e) => handleUpdate('approval:updated', e as MessageEvent));

      es.onerror = () => {
        if (!cancelled) setSseStatus('RECONNECTING');
      };
    };

    void connect();
    return () => {
      cancelled = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [user, selectedProject?.id]);

  const loginWithPassword = async (email: string, password: string) => {
    const res = await api.post<{ user: UserProfile; accessToken: string; refreshToken: string }>(
      '/auth/login',
      { email, password }
    );
    api.setTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    await refreshProjects();
    notify('success', `Welcome back, ${res.user.fullName}`);
  };

  const registerAccount = async (fullName: string, email: string, password: string, role: UserRole) => {
    const res = await api.post<{ user: UserProfile; accessToken: string; refreshToken: string }>(
      '/auth/register',
      { fullName, email, password, role }
    );
    api.setTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    await refreshProjects();
    notify('success', 'Account created successfully');
  };

  const logout = async () => {
    try {
      const rt = api.getRefreshToken();
      if (rt) {
        await api.post('/auth/logout', { refreshToken: rt });
      }
    } catch {
      // Ignore logout network issues
    } finally {
      api.setTokens(null, null);
      setUser(null);
      setProjects([]);
      setNotifications([]);
      notify('info', 'Signed out of FlagShip');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        projects,
        selectedProject,
        selectedEnvironment,
        setSelectedProjectId,
        setSelectedEnvironmentId,
        refreshProjects,
        loginWithPassword,
        registerAccount,
        logout,
        updateLocalUser: setUser,
        sseStatus,
        sseVersion,
        notifications,
        clearNotifications: () => setNotifications([]),
        toasts,
        notify,
        dismissToast,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
