export interface ApiError extends Error {
  status: number;
  title?: string;
  detail?: string;
  traceId?: string;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    try {
      this.accessToken = sessionStorage.getItem('flagship_access_token');
      this.refreshToken = sessionStorage.getItem('flagship_refresh_token');
    } catch {
      // Ignore storage access errors
    }
  }

  public setTokens(access: string | null, refresh: string | null) {
    this.accessToken = access;
    this.refreshToken = refresh;
    try {
      if (access) sessionStorage.setItem('flagship_access_token', access);
      else sessionStorage.removeItem('flagship_access_token');
      if (refresh) sessionStorage.setItem('flagship_refresh_token', refresh);
      else sessionStorage.removeItem('flagship_refresh_token');
    } catch {
      // Ignore storage errors
    }
  }

  public async getActiveBearerToken(): Promise<string | null> {
    return this.accessToken;
  }

  public getRefreshToken(): string | null {
    return this.refreshToken;
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!res.ok) {
        this.setTokens(null, null);
        return false;
      }
      const data = await res.json();
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  public async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await this.getActiveBearerToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`/api${path}`, { ...init, headers });

    if (res.status === 401 && retry && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        return this.request<T>(path, init, false);
      }
    }

    if (!res.ok) {
      let body: Record<string, unknown> = {};
      try {
        body = await res.json();
      } catch {
        // Ignore parse error
      }
      const err = new Error(
        String(body.detail || body.error || body.title || `Request failed (${res.status})`)
      ) as ApiError;
      err.status = res.status;
      err.title = typeof body.title === 'string' ? body.title : undefined;
      err.detail = typeof body.detail === 'string' ? body.detail : undefined;
      err.traceId = typeof body.traceId === 'string' ? body.traceId : undefined;
      throw err;
    }

    return (await res.json()) as T;
  }

  public get<T>(path: string) {
    return this.request<T>(path, { method: 'GET' });
  }

  public post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public put<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
