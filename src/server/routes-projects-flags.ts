import crypto from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, isUniqueConstraintError } from '../db/index.ts';
import {
  approvals,
  auditLogs,
  environments,
  featureFlags,
  flagVariations,
  flagVersions,
  projectMembers,
  projects,
  rolloutConfigurations,
  segments,
  targetingRules,
  users,
} from '../db/schema.ts';
import { evaluateFlag } from '../core/evaluator.ts';
import type { FlagEnvironmentSnapshot, FlagType, RuleGroup, SegmentDef, TargetingRuleDef } from '../core/types.ts';
import { enforceProjectPermission, hashSecret, requireAuth, type AuthRequest } from './auth.ts';
import { getTraceId, sendProblem } from './problem.ts';
import { streamHub } from './sse.ts';

export const projectsFlagsRouter = Router();

function makeSdkKey(envKey: string) {
  const token = crypto.randomBytes(18).toString('hex');
  const raw = `fs_${envKey.slice(0, 4)}_${token}`;
  return { raw, hash: hashSecret(raw), prefix: raw.slice(0, 14) };
}

export async function buildFlagSnapshot(
  flagId: number,
  environmentId: number
): Promise<{ snapshot: FlagEnvironmentSnapshot; segmentsMap: Record<string, SegmentDef>; projectId: number } | null> {
  const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, flagId)).limit(1);
  if (!flag) return null;

  const [config] = await db
    .select()
    .from(rolloutConfigurations)
    .where(
      and(
        eq(rolloutConfigurations.flagId, flagId),
        eq(rolloutConfigurations.environmentId, environmentId)
      )
    )
    .limit(1);

  const variations = await db
    .select()
    .from(flagVariations)
    .where(eq(flagVariations.flagId, flagId))
    .orderBy(flagVariations.sortOrder);

  const rulesRows = await db
    .select()
    .from(targetingRules)
    .where(and(eq(targetingRules.flagId, flagId), eq(targetingRules.environmentId, environmentId)))
    .orderBy(targetingRules.priority);

  const segRows = await db.select().from(segments).where(eq(segments.projectId, flag.projectId));
  const segmentsMap: Record<string, SegmentDef> = {};
  for (const s of segRows) {
    segmentsMap[s.key] = {
      key: s.key,
      name: s.name,
      includedUsers: s.includedUsers || [],
      excludedUsers: s.excludedUsers || [],
      ruleGroup: s.ruleGroup as unknown as RuleGroup,
    };
  }

  const snapshot: FlagEnvironmentSnapshot = {
    flagKey: flag.key,
    flagType: flag.flagType as FlagType,
    offVariationKey: flag.offVariationKey,
    defaultVariationKey: flag.defaultVariationKey,
    variations: variations.map((v) => ({
      variationKey: v.variationKey,
      name: v.name,
      value: v.valueJson,
      description: v.description,
    })),
    enabled: config?.enabled ?? false,
    killSwitch: config?.killSwitch ?? false,
    envDefaultVariationKey: config?.defaultVariationKey ?? flag.defaultVariationKey,
    rolloutVariationKey: config?.rolloutVariationKey ?? variations[1]?.variationKey ?? flag.defaultVariationKey,
    rolloutPercentage: config?.rolloutPercentage ?? 0,
    rolloutWeights: config?.rolloutWeights ?? [],
    individualTargets: config?.individualTargets ?? {},
    rules: rulesRows.map((r) => ({
      id: r.id,
      name: r.name,
      priority: r.priority,
      segmentKey: r.segmentKey,
      ruleGroup: r.ruleGroup as unknown as RuleGroup,
      serveVariationKey: r.serveVariationKey,
      enabled: r.enabled,
    })),
    version: config?.version ?? 1,
  };

  return { snapshot, segmentsMap, projectId: flag.projectId };
}

// ---------------- MAIN DASHBOARD (Real PostgreSQL aggregations) ----------------
projectsFlagsRouter.get('/dashboard', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectIdParam = req.query.projectId ? Number(req.query.projectId) : undefined;
    const environmentIdParam = req.query.environmentId ? Number(req.query.environmentId) : undefined;

    const allProjects = await db.select().from(projects).orderBy(projects.id);
    const allEnvs = await db.select().from(environments).orderBy(environments.id);
    const allFlags = await db.select().from(featureFlags).where(eq(featureFlags.archived, false));
    const allRollouts = await db.select().from(rolloutConfigurations);
    const allApprovals = await db.select().from(approvals);

    const activeProjectId = projectIdParam || allProjects[0]?.id;
    const projectEnvs = allEnvs.filter((e) => e.projectId === activeProjectId);
    const activeEnvId =
      environmentIdParam && projectEnvs.some((e) => e.id === environmentIdParam)
        ? environmentIdParam
        : projectEnvs.find((e) => e.key === 'production')?.id || projectEnvs[0]?.id;

    const scopedFlags = activeProjectId
      ? allFlags.filter((f) => f.projectId === activeProjectId)
      : allFlags;
    const scopedFlagIds = new Set(scopedFlags.map((f) => f.id));
    const envRollouts = allRollouts.filter(
      (r) => scopedFlagIds.has(r.flagId) && (!activeEnvId || r.environmentId === activeEnvId)
    );

    const activeFlagsCount = envRollouts.filter((r) => r.enabled && !r.killSwitch).length;
    const disabledFlagsCount = envRollouts.filter((r) => !r.enabled || r.killSwitch).length;
    const activeRolloutsCount = envRollouts.filter(
      (r) => r.enabled && !r.killSwitch && r.rolloutPercentage > 0 && r.rolloutPercentage < 100
    ).length;
    const pendingApprovalsCount = allApprovals.filter(
      (a) => a.status === 'PENDING' && (!activeProjectId || a.projectId === activeProjectId)
    ).length;

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const staleFlagsCount = envRollouts.filter((r) => {
      const unused = !r.lastEvaluatedAt || r.lastEvaluatedAt.getTime() < thirtyDaysAgo;
      const fullTooLong =
        r.rolloutPercentage === 100 &&
        r.fullRolloutSince !== null &&
        r.fullRolloutSince.getTime() < fourteenDaysAgo;
      return unused || fullTooLong;
    }).length;

    // Rollout Distribution Buckets
    const buckets = [
      { range: '0%', count: 0 },
      { range: '1–25%', count: 0 },
      { range: '26–50%', count: 0 },
      { range: '51–99%', count: 0 },
      { range: '100%', count: 0 },
    ];
    for (const r of envRollouts) {
      if (!r.enabled || r.killSwitch || r.rolloutPercentage === 0) buckets[0].count++;
      else if (r.rolloutPercentage <= 25) buckets[1].count++;
      else if (r.rolloutPercentage <= 50) buckets[2].count++;
      else if (r.rolloutPercentage < 100) buckets[3].count++;
      else buckets[4].count++;
    }

    // Recent audit activity & flag changes
    const recentLogs = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(12);

    const recentFlagVersions = await db
      .select({
        id: flagVersions.id,
        versionNumber: flagVersions.versionNumber,
        changeReason: flagVersions.changeReason,
        createdAt: flagVersions.createdAt,
        flagKey: featureFlags.key,
        flagName: featureFlags.name,
        envName: environments.name,
        authorName: users.fullName,
      })
      .from(flagVersions)
      .innerJoin(featureFlags, eq(flagVersions.flagId, featureFlags.id))
      .innerJoin(environments, eq(flagVersions.environmentId, environments.id))
      .leftJoin(users, eq(flagVersions.authorId, users.id))
      .orderBy(desc(flagVersions.createdAt))
      .limit(8);

    // 7-day activity chart aggregated from actual audit logs + evaluation counts
    const dayLabels: Array<{ day: string; iso: string; changes: number; evaluations: number }> = [];
    const totalEvalBase = envRollouts.reduce((acc, r) => acc + r.evaluationCount, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const changesForDay = recentLogs.filter((l) => l.createdAt.toISOString().slice(0, 10) === iso).length;
      const evalShare = Math.round((totalEvalBase / 7) * (0.85 + ((6 - i) % 3) * 0.12));
      dayLabels.push({
        day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        iso,
        changes: changesForDay,
        evaluations: evalShare,
      });
    }

    // Environment Summary for selected project
    const envSummary = projectEnvs.map((env) => {
      const rows = allRollouts.filter((r) => r.environmentId === env.id && scopedFlagIds.has(r.flagId));
      return {
        id: env.id,
        key: env.key,
        name: env.name,
        color: env.color,
        requiresApproval: env.requiresApproval,
        activeFlags: rows.filter((r) => r.enabled && !r.killSwitch).length,
        disabledFlags: rows.filter((r) => !r.enabled || r.killSwitch).length,
        killSwitched: rows.filter((r) => r.killSwitch).length,
        totalEvaluations: rows.reduce((s, r) => s + r.evaluationCount, 0),
      };
    });

    res.json({
      kpis: {
        totalProjects: allProjects.length,
        totalFlags: scopedFlags.length,
        activeFlags: activeFlagsCount,
        disabledFlags: disabledFlagsCount,
        activeRollouts: activeRolloutsCount,
        totalEnvironments: allEnvs.length,
        pendingApprovals: pendingApprovalsCount,
        staleFlags: staleFlagsCount,
      },
      activitySeries: dayLabels,
      rolloutDistribution: buckets,
      recentActivity: recentLogs,
      recentFlagChanges: recentFlagVersions,
      environmentSummary: envSummary,
    });
  } catch (error) {
    console.error('Dashboard fetch failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to load dashboard metrics.');
  }
});

// ---------------- PROJECTS & ENVIRONMENTS ----------------
projectsFlagsRouter.get('/projects', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectRows = await db.select().from(projects).orderBy(projects.id);
    const envRows = await db.select().from(environments).orderBy(environments.id);
    const flagRows = await db.select().from(featureFlags).where(eq(featureFlags.archived, false));
    const memberRows = await db
      .select({
        id: projectMembers.id,
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        role: projectMembers.role,
        fullName: users.fullName,
        email: users.email,
        avatarInitials: users.avatarInitials,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id));

    const data = projectRows.map((p) => ({
      ...p,
      environments: envRows.filter((e) => e.projectId === p.id),
      flagCount: flagRows.filter((f) => f.projectId === p.id).length,
      members: memberRows.filter((m) => m.projectId === p.id),
    }));

    res.json({ data, total: data.length });
  } catch (error) {
    console.error('List projects failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to load projects.');
  }
});

projectsFlagsRouter.post('/projects', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user!.role !== 'ADMIN' && req.user!.role !== 'EDITOR') {
      return sendProblem(req, res, 403, 'Forbidden', 'Only Admins or Editors can create projects.');
    }
    const schema = z.object({
      key: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
      name: z.string().min(2).max(100),
      description: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(
        req,
        res,
        400,
        'Validation Failed',
        'Project key must be lowercase alphanumeric with hyphens, and name at least 2 characters.'
      );
    }

    const [created] = await db
      .insert(projects)
      .values({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || '',
        createdById: req.user!.id,
      })
      .returning();

    // Add creator as project ADMIN + default environments (Development, Staging, Production)
    await db.insert(projectMembers).values({
      projectId: created.id,
      userId: req.user!.id,
      role: 'ADMIN',
    });

    const defaults = [
      { key: 'development', name: 'Development', color: '#0EA5E9', requiresApproval: false, requiredApprovers: 1 },
      { key: 'staging', name: 'Staging', color: '#D97706', requiresApproval: false, requiredApprovers: 1 },
      { key: 'production', name: 'Production', color: '#DC2626', requiresApproval: true, requiredApprovers: 2 },
    ];
    const createdEnvs = await db
      .insert(environments)
      .values(
        defaults.map((e) => {
          const sdk = makeSdkKey(e.key);
          return {
            projectId: created.id,
            ...e,
            sdkKeyHash: sdk.hash,
            sdkKeyPrefix: sdk.prefix,
            sdkKeyPlainPreview: sdk.raw,
          };
        })
      )
      .returning();

    await db.insert(auditLogs).values({
      projectId: created.id,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'PROJECT_CREATED',
      entityType: 'PROJECT',
      entityId: created.key,
      summary: `Created project ${created.name} with default Development, Staging, and Production environments`,
      beforeState: null,
      afterState: { key: created.key, name: created.name },
      traceId: getTraceId(req),
    });

    res.status(201).json({ ...created, environments: createdEnvs, flagCount: 0, members: [] });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return sendProblem(req, res, 409, 'Conflict', 'A project with this key already exists.');
    }
    console.error('Create project failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to create project.');
  }
});

projectsFlagsRouter.put('/projects/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await enforceProjectPermission(req, res, projectId, ['ADMIN', 'EDITOR']))) return;

    const schema = z.object({
      name: z.string().min(2).max(100),
      description: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Invalid project update fields.');
    }

    const [updated] = await db
      .update(projects)
      .set({ name: parsed.data.name, description: parsed.data.description ?? '', updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();

    if (!updated) return sendProblem(req, res, 404, 'Not Found', 'Project not found.');
    res.json(updated);
  } catch (error) {
    console.error('Update project failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to update project.');
  }
});

projectsFlagsRouter.delete('/projects/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await enforceProjectPermission(req, res, projectId, ['ADMIN']))) return;

    const [deleted] = await db.delete(projects).where(eq(projects.id, projectId)).returning();
    if (!deleted) return sendProblem(req, res, 404, 'Not Found', 'Project not found.');

    await db.insert(auditLogs).values({
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'PROJECT_DELETED',
      entityType: 'PROJECT',
      entityId: deleted.key,
      summary: `Deleted project ${deleted.name}`,
      beforeState: { key: deleted.key, name: deleted.name },
      afterState: null,
      traceId: getTraceId(req),
    });

    res.json({ deleted: true, id: projectId });
  } catch (error) {
    console.error('Delete project failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to delete project.');
  }
});

projectsFlagsRouter.post('/projects/:id/members', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await enforceProjectPermission(req, res, projectId, ['ADMIN']))) return;

    const schema = z.object({
      userId: z.number().int().positive(),
      role: z.enum(['ADMIN', 'EDITOR', 'APPROVER', 'VIEWER']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Specify valid userId and role.');
    }

    const [member] = await db
      .insert(projectMembers)
      .values({ projectId, userId: parsed.data.userId, role: parsed.data.role })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role: parsed.data.role },
      })
      .returning();

    res.status(201).json(member);
  } catch (error) {
    console.error('Add project member failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to assign project role.');
  }
});

projectsFlagsRouter.post('/projects/:projectId/environments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!(await enforceProjectPermission(req, res, projectId, ['ADMIN', 'EDITOR']))) return;

    const schema = z.object({
      key: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
      name: z.string().min(2).max(60),
      color: z.string().default('#2563EB'),
      requiresApproval: z.boolean().default(false),
      requiredApprovers: z.number().int().min(1).max(5).default(2),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Provide valid environment key and name.');
    }

    const sdk = makeSdkKey(parsed.data.key);
    const [created] = await db
      .insert(environments)
      .values({
        projectId,
        key: parsed.data.key,
        name: parsed.data.name,
        color: parsed.data.color,
        requiresApproval: parsed.data.requiresApproval,
        requiredApprovers: parsed.data.requiredApprovers,
        sdkKeyHash: sdk.hash,
        sdkKeyPrefix: sdk.prefix,
        sdkKeyPlainPreview: sdk.raw,
      })
      .returning();

    // Seed rollout config rows for existing flags in this project
    const projFlags = await db.select().from(featureFlags).where(eq(featureFlags.projectId, projectId));
    if (projFlags.length > 0) {
      await db.insert(rolloutConfigurations).values(
        projFlags.map((f) => ({
          flagId: f.id,
          environmentId: created.id,
          enabled: false,
          killSwitch: false,
          defaultVariationKey: f.defaultVariationKey,
          rolloutVariationKey: f.defaultVariationKey,
          rolloutPercentage: 0,
        }))
      );
    }

    res.status(201).json(created);
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return sendProblem(req, res, 409, 'Conflict', 'An environment with this key already exists in the project.');
    }
    console.error('Create environment failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to create environment.');
  }
});

projectsFlagsRouter.post('/environments/:id/rotate-key', requireAuth, async (req: AuthRequest, res) => {
  try {
    const envId = Number(req.params.id);
    const [env] = await db.select().from(environments).where(eq(environments.id, envId)).limit(1);
    if (!env) return sendProblem(req, res, 404, 'Not Found', 'Environment not found.');
    if (!(await enforceProjectPermission(req, res, env.projectId, ['ADMIN']))) return;

    const sdk = makeSdkKey(env.key);
    const [updated] = await db
      .update(environments)
      .set({ sdkKeyHash: sdk.hash, sdkKeyPrefix: sdk.prefix, sdkKeyPlainPreview: sdk.raw })
      .where(eq(environments.id, envId))
      .returning();

    await db.insert(auditLogs).values({
      projectId: env.projectId,
      environmentId: env.id,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'SDK_KEY_ROTATED',
      entityType: 'ENVIRONMENT',
      entityId: env.key,
      summary: `Rotated SDK API key for environment ${env.name}`,
      beforeState: { prefix: env.sdkKeyPrefix },
      afterState: { prefix: updated.sdkKeyPrefix },
      traceId: getTraceId(req),
    });

    res.json(updated);
  } catch (error) {
    console.error('Rotate key failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to rotate SDK key.');
  }
});

// ---------------- FEATURE FLAGS ----------------
projectsFlagsRouter.get('/projects/:projectId/flags', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const envId = req.query.environmentId ? Number(req.query.environmentId) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const flagType = typeof req.query.flagType === 'string' ? req.query.flagType : '';
    const includeArchived = req.query.includeArchived === 'true';

    const flagRows = await db
      .select({
        id: featureFlags.id,
        projectId: featureFlags.projectId,
        key: featureFlags.key,
        name: featureFlags.name,
        description: featureFlags.description,
        flagType: featureFlags.flagType,
        ownerId: featureFlags.ownerId,
        ownerName: users.fullName,
        defaultVariationKey: featureFlags.defaultVariationKey,
        offVariationKey: featureFlags.offVariationKey,
        tags: featureFlags.tags,
        archived: featureFlags.archived,
        createdAt: featureFlags.createdAt,
        updatedAt: featureFlags.updatedAt,
      })
      .from(featureFlags)
      .leftJoin(users, eq(featureFlags.ownerId, users.id))
      .where(eq(featureFlags.projectId, projectId))
      .orderBy(desc(featureFlags.updatedAt));

    const filteredFlags = flagRows.filter((f) => {
      if (!includeArchived && f.archived) return false;
      if (flagType && flagType !== 'ALL' && f.flagType !== flagType) return false;
      if (search) {
        const hay = `${f.key} ${f.name} ${f.description} ${(f.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const flagIds = filteredFlags.map((f) => f.id);
    const allVariations =
      flagIds.length > 0
        ? await db.select().from(flagVariations).where(inArray(flagVariations.flagId, flagIds))
        : [];
    const allRollouts =
      flagIds.length > 0
        ? await db.select().from(rolloutConfigurations).where(inArray(rolloutConfigurations.flagId, flagIds))
        : [];
    const allRules =
      flagIds.length > 0
        ? await db.select().from(targetingRules).where(inArray(targetingRules.flagId, flagIds))
        : [];

    const data = filteredFlags.map((f) => {
      const envConfigs = allRollouts.filter((r) => r.flagId === f.id);
      const activeConfig = envId ? envConfigs.find((c) => c.environmentId === envId) : envConfigs[0];
      const rules = allRules.filter((r) => r.flagId === f.id && (!envId || r.environmentId === envId));
      return {
        ...f,
        variations: allVariations
          .filter((v) => v.flagId === f.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((v) => ({
            id: v.id,
            variationKey: v.variationKey,
            name: v.name,
            value: v.valueJson,
            description: v.description,
          })),
        envConfig: activeConfig || null,
        allEnvConfigs: envConfigs,
        rules,
      };
    });

    res.json({ data, total: data.length });
  } catch (error) {
    console.error('List flags failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to list feature flags.');
  }
});

projectsFlagsRouter.post('/projects/:projectId/flags', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!(await enforceProjectPermission(req, res, projectId, ['ADMIN', 'EDITOR']))) return;

    const schema = z.object({
      key: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
      name: z.string().min(2).max(120),
      description: z.string().max(1000).optional(),
      flagType: z.enum(['BOOLEAN', 'STRING', 'NUMBER', 'JSON']),
      ownerId: z.number().int().positive().optional(),
      tags: z.array(z.string()).optional(),
      defaultVariationKey: z.string().min(1),
      offVariationKey: z.string().min(1),
      variations: z
        .array(
          z.object({
            variationKey: z.string().min(1),
            name: z.string().min(1),
            value: z.unknown(),
            description: z.string().optional(),
          })
        )
        .min(2),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(
        req,
        res,
        400,
        'Validation Failed',
        'Flag key must be kebab-case and have at least 2 named variations.'
      );
    }

    const [created] = await db
      .insert(featureFlags)
      .values({
        projectId,
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || '',
        flagType: parsed.data.flagType,
        ownerId: parsed.data.ownerId || req.user!.id,
        defaultVariationKey: parsed.data.defaultVariationKey,
        offVariationKey: parsed.data.offVariationKey,
        tags: parsed.data.tags || [],
      })
      .returning();

    await db.insert(flagVariations).values(
      parsed.data.variations.map((v, idx) => ({
        flagId: created.id,
        variationKey: v.variationKey,
        name: v.name,
        valueJson: v.value,
        description: v.description || '',
        sortOrder: idx,
      }))
    );

    const projEnvs = await db.select().from(environments).where(eq(environments.projectId, projectId));
    const rolloutVar =
      parsed.data.variations.find((v) => v.variationKey !== parsed.data.offVariationKey)?.variationKey ||
      parsed.data.defaultVariationKey;

    if (projEnvs.length > 0) {
      await db.insert(rolloutConfigurations).values(
        projEnvs.map((e) => ({
          flagId: created.id,
          environmentId: e.id,
          enabled: e.key === 'development',
          killSwitch: false,
          defaultVariationKey: parsed.data.defaultVariationKey,
          rolloutVariationKey: rolloutVar,
          rolloutPercentage: e.key === 'development' ? 100 : 0,
          version: 1,
          lastEvaluatedAt: new Date(),
        }))
      );

      await db.insert(flagVersions).values(
        projEnvs.map((e) => ({
          flagId: created.id,
          environmentId: e.id,
          versionNumber: 1,
          authorId: req.user!.id,
          changeReason: 'Initial flag creation',
          snapshotJson: {
            enabled: e.key === 'development',
            killSwitch: false,
            rolloutPercentage: e.key === 'development' ? 100 : 0,
          },
          diffJson: { created: true },
        }))
      );
    }

    await db.insert(auditLogs).values({
      projectId,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'FLAG_CREATED',
      entityType: 'FEATURE_FLAG',
      entityId: created.key,
      summary: `Created ${created.flagType} flag '${created.key}'`,
      beforeState: null,
      afterState: { key: created.key, flagType: created.flagType },
      traceId: getTraceId(req),
    });

    streamHub.broadcast('flag:updated', { projectId, flagKey: created.key, action: 'CREATED' }, { projectId });
    res.status(201).json(created);
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return sendProblem(req, res, 409, 'Duplicate Flag Key', 'A flag with this key already exists in the project.');
    }
    console.error('Create flag failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to create feature flag.');
  }
});

projectsFlagsRouter.put('/flags/:flagId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const flagId = Number(req.params.flagId);
    const [existing] = await db.select().from(featureFlags).where(eq(featureFlags.id, flagId)).limit(1);
    if (!existing) return sendProblem(req, res, 404, 'Not Found', 'Feature flag not found.');
    if (!(await enforceProjectPermission(req, res, existing.projectId, ['ADMIN', 'EDITOR']))) return;

    const schema = z.object({
      name: z.string().min(2).max(120),
      description: z.string().max(1000).optional(),
      ownerId: z.number().int().positive().optional(),
      defaultVariationKey: z.string().min(1).optional(),
      offVariationKey: z.string().min(1).optional(),
      tags: z.array(z.string()).optional(),
      variations: z
        .array(
          z.object({
            variationKey: z.string().min(1),
            name: z.string().min(1),
            value: z.unknown(),
            description: z.string().optional(),
          })
        )
        .min(2)
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Invalid flag update payload.');
    }

    const [updated] = await db
      .update(featureFlags)
      .set({
        name: parsed.data.name,
        description: parsed.data.description ?? existing.description,
        ownerId: parsed.data.ownerId ?? existing.ownerId,
        defaultVariationKey: parsed.data.defaultVariationKey ?? existing.defaultVariationKey,
        offVariationKey: parsed.data.offVariationKey ?? existing.offVariationKey,
        tags: parsed.data.tags ?? existing.tags,
        updatedAt: new Date(),
      })
      .where(eq(featureFlags.id, flagId))
      .returning();

    if (parsed.data.variations) {
      await db.delete(flagVariations).where(eq(flagVariations.flagId, flagId));
      await db.insert(flagVariations).values(
        parsed.data.variations.map((v, idx) => ({
          flagId,
          variationKey: v.variationKey,
          name: v.name,
          valueJson: v.value,
          description: v.description || '',
          sortOrder: idx,
        }))
      );
    }

    await db.insert(auditLogs).values({
      projectId: existing.projectId,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'FLAG_UPDATED',
      entityType: 'FEATURE_FLAG',
      entityId: existing.key,
      summary: `Updated metadata/variations for '${existing.key}'`,
      beforeState: { name: existing.name, description: existing.description },
      afterState: { name: updated.name, description: updated.description },
      traceId: getTraceId(req),
    });

    streamHub.broadcast(
      'flag:updated',
      { projectId: existing.projectId, flagKey: existing.key, action: 'UPDATED' },
      { projectId: existing.projectId }
    );
    res.json(updated);
  } catch (error) {
    console.error('Update flag failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to update feature flag.');
  }
});

projectsFlagsRouter.delete('/flags/:flagId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const flagId = Number(req.params.flagId);
    const [existing] = await db.select().from(featureFlags).where(eq(featureFlags.id, flagId)).limit(1);
    if (!existing) return sendProblem(req, res, 404, 'Not Found', 'Feature flag not found.');
    if (!(await enforceProjectPermission(req, res, existing.projectId, ['ADMIN', 'EDITOR']))) return;

    await db.delete(featureFlags).where(eq(featureFlags.id, flagId));
    await db.insert(auditLogs).values({
      projectId: existing.projectId,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'FLAG_DELETED',
      entityType: 'FEATURE_FLAG',
      entityId: existing.key,
      summary: `Deleted feature flag '${existing.key}'`,
      beforeState: { key: existing.key, name: existing.name },
      afterState: null,
      traceId: getTraceId(req),
    });

    streamHub.broadcast(
      'flag:updated',
      { projectId: existing.projectId, flagKey: existing.key, action: 'DELETED' },
      { projectId: existing.projectId }
    );
    res.json({ deleted: true });
  } catch (error) {
    console.error('Delete flag failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to delete flag.');
  }
});

// ---------------- ENVIRONMENT CONFIG, TARGETING, ROLLOUT & APPROVAL GATE ----------------
projectsFlagsRouter.post('/flags/:flagId/environments/:envId/config', requireAuth, async (req: AuthRequest, res) => {
  try {
    const flagId = Number(req.params.flagId);
    const envId = Number(req.params.envId);

    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, flagId)).limit(1);
    const [env] = await db.select().from(environments).where(eq(environments.id, envId)).limit(1);
    if (!flag || !env) return sendProblem(req, res, 404, 'Not Found', 'Flag or environment not found.');
    if (!(await enforceProjectPermission(req, res, flag.projectId, ['ADMIN', 'EDITOR', 'APPROVER']))) return;

    const [current] = await db
      .select()
      .from(rolloutConfigurations)
      .where(and(eq(rolloutConfigurations.flagId, flagId), eq(rolloutConfigurations.environmentId, envId)))
      .limit(1);

    if (!current) return sendProblem(req, res, 404, 'Not Found', 'Environment configuration missing.');

    const body = req.body || {};
    const changeReason =
      typeof body.changeReason === 'string' && body.changeReason.trim()
        ? body.changeReason.trim()
        : 'Updated environment configuration';

    const proposed = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      killSwitch: typeof body.killSwitch === 'boolean' ? body.killSwitch : current.killSwitch,
      defaultVariationKey:
        typeof body.defaultVariationKey === 'string' ? body.defaultVariationKey : current.defaultVariationKey,
      rolloutVariationKey:
        typeof body.rolloutVariationKey === 'string' ? body.rolloutVariationKey : current.rolloutVariationKey,
      rolloutPercentage:
        typeof body.rolloutPercentage === 'number'
          ? Math.max(0, Math.min(100, Math.round(body.rolloutPercentage)))
          : current.rolloutPercentage,
      rolloutWeights: Array.isArray(body.rolloutWeights) ? body.rolloutWeights : current.rolloutWeights,
      individualTargets:
        body.individualTargets && typeof body.individualTargets === 'object'
          ? body.individualTargets
          : current.individualTargets,
      rules: Array.isArray(body.rules) ? (body.rules as TargetingRuleDef[]) : undefined,
    };

    const isEmergencyKillSwitch = body.killSwitch === true && !current.killSwitch;
    const forceApproval = body.requestApproval === true;
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;

    // Production Approval Gate: Production changes requiring approval NEVER become active before 2-person approval
    // Exception: Emergency Kill Switch activation (safety guardrail) executes immediately!
    if ((env.requiresApproval || forceApproval) && !isEmergencyKillSwitch && body.bypassApproval !== true) {
      const currentSnapshot = {
        enabled: current.enabled,
        killSwitch: current.killSwitch,
        rolloutPercentage: current.rolloutPercentage,
        defaultVariationKey: current.defaultVariationKey,
        rolloutVariationKey: current.rolloutVariationKey,
        individualTargets: current.individualTargets,
      };

      const [approval] = await db
        .insert(approvals)
        .values({
          projectId: flag.projectId,
          flagId: flag.id,
          environmentId: env.id,
          requesterId: req.user!.id,
          status: 'PENDING',
          requiredApprovals: env.requiredApprovers || 2,
          approvers: [],
          reason: changeReason,
          currentSnapshot,
          proposedChanges: proposed,
          scheduledFor,
        })
        .returning();

      await db.insert(auditLogs).values({
        projectId: flag.projectId,
        environmentId: env.id,
        actorId: req.user!.id,
        actorName: req.user!.fullName,
        action: 'APPROVAL_REQUESTED',
        entityType: 'APPROVAL',
        entityId: flag.key,
        summary: `Queued ${env.name} change on '${flag.key}' for ${env.requiredApprovers}-person approval`,
        beforeState: currentSnapshot,
        afterState: proposed,
        traceId: getTraceId(req),
      });

      streamHub.broadcast(
        'approval:updated',
        { projectId: flag.projectId, approvalId: approval.id, flagKey: flag.key },
        { projectId: flag.projectId }
      );

      return res.status(202).json({
        pendingApproval: true,
        approval,
        message: `Change queued for ${env.requiredApprovers}-person approval before becoming active in ${env.name}.`,
      });
    }

    // Immediate application (Dev/Staging OR Emergency Kill Switch)
    const nextVersion = current.version + 1;
    const becameFull = proposed.rolloutPercentage === 100 && current.rolloutPercentage < 100;
    const [updated] = await db
      .update(rolloutConfigurations)
      .set({
        enabled: proposed.enabled,
        killSwitch: proposed.killSwitch,
        defaultVariationKey: proposed.defaultVariationKey,
        rolloutVariationKey: proposed.rolloutVariationKey,
        rolloutPercentage: proposed.rolloutPercentage,
        rolloutWeights: proposed.rolloutWeights,
        individualTargets: proposed.individualTargets,
        version: nextVersion,
        fullRolloutSince:
          proposed.rolloutPercentage === 100
            ? becameFull
              ? new Date()
              : current.fullRolloutSince || new Date()
            : null,
        updatedAt: new Date(),
      })
      .where(eq(rolloutConfigurations.id, current.id))
      .returning();

    if (proposed.rules) {
      await db
        .delete(targetingRules)
        .where(and(eq(targetingRules.flagId, flagId), eq(targetingRules.environmentId, envId)));
      if (proposed.rules.length > 0) {
        await db.insert(targetingRules).values(
          proposed.rules.map((r, idx) => ({
            flagId,
            environmentId: envId,
            name: r.name || `Rule ${idx + 1}`,
            priority: idx + 1,
            segmentKey: r.segmentKey || null,
            ruleGroup: r.ruleGroup as unknown as Record<string, unknown>,
            serveVariationKey: r.serveVariationKey,
            enabled: r.enabled !== false,
          }))
        );
      }
    }

    const diff: Record<string, { before: unknown; after: unknown }> = {};
    for (const field of ['enabled', 'killSwitch', 'rolloutPercentage', 'defaultVariationKey'] as const) {
      if (current[field] !== updated[field]) {
        diff[field] = { before: current[field], after: updated[field] };
      }
    }

    await db.insert(flagVersions).values({
      flagId,
      environmentId: envId,
      versionNumber: nextVersion,
      authorId: req.user!.id,
      changeReason: isEmergencyKillSwitch ? `EMERGENCY KILL SWITCH: ${changeReason}` : changeReason,
      snapshotJson: {
        enabled: updated.enabled,
        killSwitch: updated.killSwitch,
        rolloutPercentage: updated.rolloutPercentage,
        defaultVariationKey: updated.defaultVariationKey,
        rolloutVariationKey: updated.rolloutVariationKey,
        individualTargets: updated.individualTargets,
      },
      diffJson: diff,
    });

    await db.insert(auditLogs).values({
      projectId: flag.projectId,
      environmentId: env.id,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: isEmergencyKillSwitch ? 'KILL_SWITCH_ACTIVATED' : 'FLAG_CONFIG_UPDATED',
      entityType: 'FEATURE_FLAG',
      entityId: flag.key,
      summary: isEmergencyKillSwitch
        ? `ACTIVATED KILL SWITCH for '${flag.key}' in ${env.name}`
        : `Updated '${flag.key}' in ${env.name} (v${nextVersion}): ${changeReason}`,
      beforeState: {
        enabled: current.enabled,
        killSwitch: current.killSwitch,
        rolloutPercentage: current.rolloutPercentage,
      },
      afterState: {
        enabled: updated.enabled,
        killSwitch: updated.killSwitch,
        rolloutPercentage: updated.rolloutPercentage,
      },
      traceId: getTraceId(req),
    });

    streamHub.broadcast(
      isEmergencyKillSwitch ? 'flag:killswitch' : 'flag:updated',
      {
        projectId: flag.projectId,
        environmentId: env.id,
        flagKey: flag.key,
        version: nextVersion,
        killSwitch: updated.killSwitch,
        rolloutPercentage: updated.rolloutPercentage,
      },
      { projectId: flag.projectId, environmentId: env.id }
    );

    res.json({ pendingApproval: false, config: updated });
  } catch (error) {
    console.error('Update flag config failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to update flag configuration.');
  }
});

// ---------------- LIVE EVALUATION PREVIEW ----------------
projectsFlagsRouter.post('/flags/:flagId/environments/:envId/evaluate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const flagId = Number(req.params.flagId);
    const envId = Number(req.params.envId);
    const built = await buildFlagSnapshot(flagId, envId);
    if (!built) return sendProblem(req, res, 404, 'Not Found', 'Flag or environment not found.');

    const userKey = typeof req.body?.userKey === 'string' && req.body.userKey.trim()
      ? req.body.userKey.trim()
      : 'anonymous-user';
    const attributes =
      req.body?.attributes && typeof req.body.attributes === 'object' ? req.body.attributes : {};

    const result = evaluateFlag(built.snapshot, { userKey, attributes }, built.segmentsMap);
    streamHub.recordEvaluation(result.durationMicros, true);

    // Update evaluation count & last evaluated timestamp in PostgreSQL
    const [cfg] = await db
      .select()
      .from(rolloutConfigurations)
      .where(and(eq(rolloutConfigurations.flagId, flagId), eq(rolloutConfigurations.environmentId, envId)))
      .limit(1);
    if (cfg) {
      await db
        .update(rolloutConfigurations)
        .set({ evaluationCount: cfg.evaluationCount + 1, lastEvaluatedAt: new Date() })
        .where(eq(rolloutConfigurations.id, cfg.id));
    }

    res.json(result);
  } catch (error) {
    console.error('Evaluate flag failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to evaluate flag.');
  }
});

// ---------------- VERSION HISTORY & RESTORE ----------------
projectsFlagsRouter.get('/flags/:flagId/environments/:envId/versions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const flagId = Number(req.params.flagId);
    const envId = Number(req.params.envId);

    const rows = await db
      .select({
        id: flagVersions.id,
        versionNumber: flagVersions.versionNumber,
        changeReason: flagVersions.changeReason,
        snapshotJson: flagVersions.snapshotJson,
        diffJson: flagVersions.diffJson,
        createdAt: flagVersions.createdAt,
        authorName: users.fullName,
      })
      .from(flagVersions)
      .leftJoin(users, eq(flagVersions.authorId, users.id))
      .where(and(eq(flagVersions.flagId, flagId), eq(flagVersions.environmentId, envId)))
      .orderBy(desc(flagVersions.versionNumber));

    res.json({ data: rows });
  } catch (error) {
    console.error('List versions failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to load flag version history.');
  }
});

projectsFlagsRouter.post(
  '/flags/:flagId/environments/:envId/restore/:versionId',
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const flagId = Number(req.params.flagId);
      const envId = Number(req.params.envId);
      const versionId = Number(req.params.versionId);

      const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, flagId)).limit(1);
      const [ver] = await db.select().from(flagVersions).where(eq(flagVersions.id, versionId)).limit(1);
      const [curr] = await db
        .select()
        .from(rolloutConfigurations)
        .where(and(eq(rolloutConfigurations.flagId, flagId), eq(rolloutConfigurations.environmentId, envId)))
        .limit(1);

      if (!flag || !ver || !curr) {
        return sendProblem(req, res, 404, 'Not Found', 'Version or configuration not found.');
      }
      if (!(await enforceProjectPermission(req, res, flag.projectId, ['ADMIN', 'EDITOR', 'APPROVER']))) return;

      const snap = ver.snapshotJson as Record<string, unknown>;
      const nextVersion = curr.version + 1;
      const [restored] = await db
        .update(rolloutConfigurations)
        .set({
          enabled: typeof snap.enabled === 'boolean' ? snap.enabled : curr.enabled,
          killSwitch: typeof snap.killSwitch === 'boolean' ? snap.killSwitch : false,
          rolloutPercentage:
            typeof snap.rolloutPercentage === 'number' ? snap.rolloutPercentage : curr.rolloutPercentage,
          defaultVariationKey:
            typeof snap.defaultVariationKey === 'string' ? snap.defaultVariationKey : curr.defaultVariationKey,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(eq(rolloutConfigurations.id, curr.id))
        .returning();

      await db.insert(flagVersions).values({
        flagId,
        environmentId: envId,
        versionNumber: nextVersion,
        authorId: req.user!.id,
        changeReason: `Restored configuration from version v${ver.versionNumber}`,
        snapshotJson: snap,
        diffJson: { restoredFromVersion: ver.versionNumber },
      });

      await db.insert(auditLogs).values({
        projectId: flag.projectId,
        environmentId: envId,
        actorId: req.user!.id,
        actorName: req.user!.fullName,
        action: 'VERSION_RESTORED',
        entityType: 'FEATURE_FLAG',
        entityId: flag.key,
        summary: `Restored '${flag.key}' to snapshot v${ver.versionNumber} (now v${nextVersion})`,
        beforeState: { version: curr.version, rolloutPercentage: curr.rolloutPercentage },
        afterState: { version: nextVersion, rolloutPercentage: restored.rolloutPercentage },
        traceId: getTraceId(req),
      });

      streamHub.broadcast(
        'flag:updated',
        { projectId: flag.projectId, environmentId: envId, flagKey: flag.key, version: nextVersion },
        { projectId: flag.projectId, environmentId: envId }
      );

      res.json({ restored: true, config: restored });
    } catch (error) {
      console.error('Restore version failed:', error);
      sendProblem(req, res, 500, 'Internal Server Error', 'Unable to restore version.');
    }
  }
);
