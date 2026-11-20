import crypto from 'node:crypto';
import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { auditLogs, projectMembers, projects, refreshTokens, users } from '../db/schema.ts';
import {
  computeInitials,
  hashPassword,
  hashSecret,
  issueTokenPair,
  requireAuth,
  rotateRefreshToken,
  verifyPassword,
  type AuthRequest,
} from './auth.ts';
import { getTraceId, sendProblem } from './problem.ts';
import { ensureSeeded } from './seed.ts';
import type { UserRole } from '../core/types.ts';

export const authUsersRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(100),
  password: z.string().min(8).max(128),
  role: z.enum(['ADMIN', 'EDITOR', 'APPROVER', 'VIEWER']).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

authUsersRouter.post('/auth/login', async (req, res) => {
  try {
    await ensureSeeded();
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Provide a valid email and password.');
    }

    const email = parsed.data.email.trim().toLowerCase();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (rows.length === 0 || !rows[0].passwordHash) {
      return sendProblem(req, res, 401, 'Invalid Credentials', 'Email or password is incorrect.');
    }

    const userRow = rows[0];
    if (!userRow.passwordHash) {
      return sendProblem(req, res, 401, 'Invalid Credentials', 'Email or password is incorrect.');
    }
    if (!userRow.active) {
      return sendProblem(req, res, 403, 'Account Disabled', 'This account has been deactivated.');
    }

    const valid = await verifyPassword(parsed.data.password, userRow.passwordHash);
    if (!valid) {
      return sendProblem(req, res, 401, 'Invalid Credentials', 'Email or password is incorrect.');
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userRow.id));

    const authUser = {
      id: userRow.id,
      uid: userRow.uid,
      email: userRow.email,
      fullName: userRow.fullName,
      role: userRow.role as UserRole,
      avatarInitials: userRow.avatarInitials,
    };
    const tokens = await issueTokenPair(authUser);

    await db.insert(auditLogs).values({
      actorId: userRow.id,
      actorName: userRow.fullName,
      action: 'USER_LOGIN',
      entityType: 'USER',
      entityId: String(userRow.id),
      summary: `${userRow.fullName} signed in via JWT`,
      beforeState: null,
      afterState: { email: userRow.email },
      traceId: getTraceId(req),
    });

    res.json({ user: authUser, ...tokens });
  } catch (error) {
    console.error('Login failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to process login.');
  }
});

authUsersRouter.post('/auth/register', async (req, res) => {
  try {
    await ensureSeeded();
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(
        req,
        res,
        400,
        'Validation Failed',
        'Please supply a valid name, email, and password (minimum 8 characters).'
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return sendProblem(req, res, 409, 'Email Already Registered', 'An account with this email already exists.');
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const assignedRole: UserRole = parsed.data.role || 'EDITOR';
    const [created] = await db
      .insert(users)
      .values({
        email,
        fullName: parsed.data.fullName.trim(),
        passwordHash,
        role: assignedRole,
        avatarInitials: computeInitials(parsed.data.fullName),
        lastLoginAt: new Date(),
      })
      .returning();

    // Grant access to existing projects so the newly registered user can explore immediately
    const allProjects = await db.select().from(projects);
    if (allProjects.length > 0) {
      await db.insert(projectMembers).values(
        allProjects.map((p) => ({
          projectId: p.id,
          userId: created.id,
          role: assignedRole,
        }))
      );
    }

    const authUser = {
      id: created.id,
      uid: created.uid,
      email: created.email,
      fullName: created.fullName,
      role: created.role as UserRole,
      avatarInitials: created.avatarInitials,
    };
    const tokens = await issueTokenPair(authUser);

    await db.insert(auditLogs).values({
      actorId: created.id,
      actorName: created.fullName,
      action: 'USER_REGISTERED',
      entityType: 'USER',
      entityId: String(created.id),
      summary: `Registered new user ${created.fullName} (${assignedRole})`,
      beforeState: null,
      afterState: { email: created.email, role: assignedRole },
      traceId: getTraceId(req),
    });

    res.status(201).json({ user: authUser, ...tokens });
  } catch (error) {
    console.error('Registration failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to register account.');
  }
});

authUsersRouter.post('/auth/refresh', async (req, res) => {
  try {
    const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
    if (!token) {
      return sendProblem(req, res, 400, 'Missing Refresh Token', 'Provide refreshToken in request body.');
    }
    const rotated = await rotateRefreshToken(token);
    if (!rotated) {
      return sendProblem(req, res, 401, 'Invalid Refresh Token', 'Refresh token is expired or revoked.');
    }
    res.json(rotated);
  } catch (error) {
    console.error('Refresh failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to rotate token.');
  }
});

authUsersRouter.post('/auth/logout', async (req, res) => {
  try {
    const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
    if (token) {
      await db
        .update(refreshTokens)
        .set({ revoked: true })
        .where(eq(refreshTokens.tokenHash, hashSecret(token)));
    }
    res.json({ status: 'logged_out' });
  } catch (error) {
    console.error('Logout failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to complete logout.');
  }
});

authUsersRouter.get('/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureSeeded();
    const user = req.user!;
    // Ensure Firebase-authenticated users have membership on seeded projects
    const existingMemberships = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.userId, user.id));
    if (existingMemberships.length === 0) {
      const allProjects = await db.select().from(projects);
      if (allProjects.length > 0) {
        await db
          .insert(projectMembers)
          .values(allProjects.map((p) => ({ projectId: p.id, userId: user.id, role: user.role })))
          .onConflictDoNothing();
      }
    }
    res.json({ user });
  } catch (error) {
    console.error('Fetch me failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to load current user.');
  }
});

authUsersRouter.post('/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(
        req,
        res,
        400,
        'Validation Failed',
        'New password must be at least 8 characters long.'
      );
    }

    const rows = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (rows.length === 0) {
      return sendProblem(req, res, 404, 'Not Found', 'User not found.');
    }

    const userRow = rows[0];
    if (userRow.passwordHash) {
      const ok = await verifyPassword(parsed.data.currentPassword, userRow.passwordHash);
      if (!ok) {
        return sendProblem(req, res, 400, 'Incorrect Password', 'Current password does not match.');
      }
    }

    const nextHash = await hashPassword(parsed.data.newPassword);
    await db
      .update(users)
      .set({ passwordHash: nextHash, updatedAt: new Date() })
      .where(eq(users.id, userRow.id));

    await db.insert(auditLogs).values({
      actorId: userRow.id,
      actorName: userRow.fullName,
      action: 'PASSWORD_CHANGED',
      entityType: 'USER',
      entityId: String(userRow.id),
      summary: `${userRow.fullName} updated their password`,
      beforeState: null,
      afterState: null,
      traceId: getTraceId(req),
    });

    res.json({ status: 'updated' });
  } catch (error) {
    console.error('Change password failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to update password.');
  }
});

authUsersRouter.patch('/auth/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    if (fullName.length < 2) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Full name must be at least 2 characters.');
    }
    const [updated] = await db
      .update(users)
      .set({ fullName, avatarInitials: computeInitials(fullName), updatedAt: new Date() })
      .where(eq(users.id, req.user!.id))
      .returning();

    res.json({
      user: {
        id: updated.id,
        uid: updated.uid,
        email: updated.email,
        fullName: updated.fullName,
        role: updated.role,
        avatarInitials: updated.avatarInitials,
      },
    });
  } catch (error) {
    console.error('Profile update failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to update profile.');
  }
});

authUsersRouter.get('/users', requireAuth, async (req: AuthRequest, res) => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        avatarInitials: users.avatarInitials,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.id);

    const memberships = await db
      .select({
        userId: projectMembers.userId,
        projectId: projectMembers.projectId,
        role: projectMembers.role,
        projectName: projects.name,
        projectKey: projects.key,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id));

    const data = allUsers.map((u) => ({
      ...u,
      projects: memberships.filter((m) => m.userId === u.id),
    }));

    res.json({ data, total: data.length });
  } catch (error) {
    console.error('List users failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to load users.');
  }
});

authUsersRouter.patch('/users/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user!.role !== 'ADMIN') {
      return sendProblem(req, res, 403, 'Forbidden', 'Only administrators can modify user roles or status.');
    }
    const targetId = Number(req.params.id);
    const schema = z.object({
      role: z.enum(['ADMIN', 'EDITOR', 'APPROVER', 'VIEWER']).optional(),
      active: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Invalid user update payload.');
    }

    const [updated] = await db
      .update(users)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(users.id, targetId))
      .returning();

    if (!updated) {
      return sendProblem(req, res, 404, 'Not Found', 'User not found.');
    }

    await db.insert(auditLogs).values({
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: String(targetId),
      summary: `Updated user ${updated.fullName} (role: ${updated.role}, active: ${updated.active})`,
      beforeState: null,
      afterState: { role: updated.role, active: updated.active },
      traceId: getTraceId(req),
    });

    res.json({
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      role: updated.role,
      active: updated.active,
    });
  } catch (error) {
    console.error('Update user failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to update user.');
  }
});

authUsersRouter.get('/users/:id/activity', requireAuth, async (req: AuthRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, targetId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(40);
    res.json({ data: logs });
  } catch (error) {
    console.error('User activity failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to fetch user activity.');
  }
});

authUsersRouter.get('/auth/demo-info', async (_req, res) => {
  try {
    await ensureSeeded();
    res.json({
      accounts: [
        { email: 'admin@flagship.dev', role: 'ADMIN', name: 'Aria Chen' },
        { email: 'editor@flagship.dev', role: 'EDITOR', name: 'Marcus Vance' },
        { email: 'approver@flagship.dev', role: 'APPROVER', name: 'Priya Nair' },
        { email: 'viewer@flagship.dev', role: 'VIEWER', name: 'David Okafor' },
      ],
    });
  } catch (error) {
    console.error('Demo info failed:', error);
    res.status(500).json({ error: 'Database initialization failed' });
  }
});
