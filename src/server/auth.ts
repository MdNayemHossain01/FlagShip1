import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { projectMembers, refreshTokens, users } from '../db/schema.ts';
import { sendProblem } from './problem.ts';
import type { UserRole } from '../core/types.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'flagship-dev-jwt-secret-key-2026-change-in-prod';
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'flagship-dev-refresh-secret-key-2026-change-in-prod';

export interface AuthenticatedUser {
  id: number;
  uid: string | null;
  email: string;
  fullName: string;
  role: UserRole;
  avatarInitials: string;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

const ROLE_WEIGHT: Record<UserRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  APPROVER: 3,
  ADMIN: 4,
};

export function hashSecret(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'FS';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export async function issueTokenPair(user: AuthenticatedUser) {
  const accessToken = jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  const rawRefresh = crypto.randomBytes(40).toString('hex');
  const signedRefresh = jwt.sign({ sub: String(user.id), jti: rawRefresh }, JWT_REFRESH_SECRET, {
    expiresIn: '14d',
  });
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashSecret(signedRefresh),
    expiresAt,
  });

  return { accessToken, refreshToken: signedRefresh };
}

export async function rotateRefreshToken(oldToken: string) {
  let payload: { sub?: string };
  try {
    payload = jwt.verify(oldToken, JWT_REFRESH_SECRET) as { sub?: string };
  } catch {
    return null;
  }

  const tokenHash = hashSecret(oldToken);
  const existing = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.revoked, false)))
    .limit(1);

  if (existing.length === 0 || existing[0].expiresAt.getTime() < Date.now()) {
    return null;
  }

  // Revoke old refresh token (strict rotation)
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, existing[0].id));

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, Number(payload.sub)))
    .limit(1);

  if (userRows.length === 0 || !userRows[0].active) return null;

  const u = userRows[0];
  const authUser: AuthenticatedUser = {
    id: u.id,
    uid: u.uid,
    email: u.email,
    fullName: u.fullName,
    role: u.role as UserRole,
    avatarInitials: u.avatarInitials,
  };
  const tokens = await issueTokenPair(authUser);
  return { user: authUser, ...tokens };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;

  if (!token) {
    return sendProblem(req, res, 401, 'Unauthorized', 'Authentication token is missing.');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string };
    if (decoded.sub) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, Number(decoded.sub)))
        .limit(1);
      if (rows.length > 0 && rows[0].active) {
        const u = rows[0];
        req.user = {
          id: u.id,
          uid: u.uid,
          email: u.email,
          fullName: u.fullName,
          role: u.role as UserRole,
          avatarInitials: u.avatarInitials,
        };
        return next();
      }
    }
  } catch {
    // Invalid or expired JWT
  }

  return sendProblem(req, res, 401, 'Unauthorized', 'Invalid or expired authentication token.');
}

export async function getEffectiveProjectRole(
  user: AuthenticatedUser,
  projectId: number
): Promise<UserRole | null> {
  if (user.role === 'ADMIN') return 'ADMIN';
  const membership = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
    .limit(1);
  if (membership.length > 0) {
    return membership[0].role as UserRole;
  }
  return user.role;
}

export function hasRequiredRole(actual: UserRole | null, allowed: UserRole[]): boolean {
  if (!actual) return false;
  if (actual === 'ADMIN') return true;
  if (allowed.includes(actual)) return true;
  const minWeight = Math.min(...allowed.map((r) => ROLE_WEIGHT[r]));
  return ROLE_WEIGHT[actual] >= minWeight && allowed.includes('EDITOR') && actual === 'APPROVER'
    ? true
    : allowed.includes(actual);
}

export async function enforceProjectPermission(
  req: AuthRequest,
  res: Response,
  projectId: number,
  allowedRoles: UserRole[]
): Promise<boolean> {
  if (!req.user) {
    sendProblem(req, res, 401, 'Unauthorized', 'Authentication required.');
    return false;
  }
  const effectiveRole = await getEffectiveProjectRole(req.user, projectId);
  if (!effectiveRole || (!allowedRoles.includes(effectiveRole) && effectiveRole !== 'ADMIN')) {
    sendProblem(
      req,
      res,
      403,
      'Forbidden',
      `Role '${effectiveRole || 'NONE'}' lacks permission for this project action. Required: ${allowedRoles.join(', ')}.`
    );
    return false;
  }
  return true;
}
