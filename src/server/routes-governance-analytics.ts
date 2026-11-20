import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, dbEngineMode, isUniqueConstraintError } from '../db/index.ts';
import {
  approvals,
  auditLogs,
  environments,
  experiments,
  experimentVariations,
  exposureEvents,
  featureFlags,
  flagVariations,
  flagVersions,
  goalEvents,
  projects,
  rolloutConfigurations,
  segments,
  targetingRules,
  users,
} from '../db/schema.ts';
import { analyzeExperiment } from '../core/statistics.ts';
import type { FlagEnvironmentSnapshot, FlagType, RuleGroup, SegmentDef, TargetingRuleDef } from '../core/types.ts';
import { enforceProjectPermission, hashSecret, requireAuth, type AuthRequest } from './auth.ts';
import { getTraceId, sendProblem } from './problem.ts';
import { streamHub } from './sse.ts';

export const governanceAnalyticsRouter = Router();

async function applyApprovedChange(
  requestRow: typeof approvals.$inferSelect,
  actorId: number | null,
  actorName: string,
  nextApprovers: Array<{ userId: number; userName: string; decision: 'APPROVED' | 'REJECTED'; comment: string; decidedAt: string }>,
  traceId: string
) {
  const proposed = requestRow.proposedChanges as Record<string, unknown>;
  const [curr] = await db
    .select()
    .from(rolloutConfigurations)
    .where(
      and(
        eq(rolloutConfigurations.flagId, requestRow.flagId),
        eq(rolloutConfigurations.environmentId, requestRow.environmentId)
      )
    )
    .limit(1);

  if (curr) {
    const nextVersion = curr.version + 1;
    const nextRolloutPct =
      typeof proposed.rolloutPercentage === 'number' ? proposed.rolloutPercentage : curr.rolloutPercentage;
    const becameFull = nextRolloutPct === 100 && curr.rolloutPercentage < 100;

    await db
      .update(rolloutConfigurations)
      .set({
        enabled: typeof proposed.enabled === 'boolean' ? proposed.enabled : curr.enabled,
        killSwitch: typeof proposed.killSwitch === 'boolean' ? proposed.killSwitch : curr.killSwitch,
        rolloutPercentage: nextRolloutPct,
        defaultVariationKey:
          typeof proposed.defaultVariationKey === 'string'
            ? proposed.defaultVariationKey
            : curr.defaultVariationKey,
        rolloutVariationKey:
          typeof proposed.rolloutVariationKey === 'string'
            ? proposed.rolloutVariationKey
            : curr.rolloutVariationKey,
        rolloutWeights: Array.isArray(proposed.rolloutWeights)
          ? (proposed.rolloutWeights as Array<{ variationKey: string; weight: number }>)
          : curr.rolloutWeights,
        individualTargets:
          proposed.individualTargets && typeof proposed.individualTargets === 'object'
            ? (proposed.individualTargets as Record<string, string>)
            : curr.individualTargets,
        fullRolloutSince:
          nextRolloutPct === 100 ? (becameFull ? new Date() : curr.fullRolloutSince || new Date()) : null,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(rolloutConfigurations.id, curr.id));

    if (Array.isArray(proposed.rules)) {
      const rulesList = proposed.rules as TargetingRuleDef[];
      await db
        .delete(targetingRules)
        .where(
          and(
            eq(targetingRules.flagId, requestRow.flagId),
            eq(targetingRules.environmentId, requestRow.environmentId)
          )
        );
      if (rulesList.length > 0) {
        await db.insert(targetingRules).values(
          rulesList.map((r, idx) => ({
            flagId: requestRow.flagId,
            environmentId: requestRow.environmentId,
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

    await db.insert(flagVersions).values({
      flagId: requestRow.flagId,
      environmentId: requestRow.environmentId,
      versionNumber: nextVersion,
      authorId: actorId,
      changeReason: `Applied approved request #${requestRow.id}: ${requestRow.reason}`,
      snapshotJson: proposed,
      diffJson: { approvalId: requestRow.id, approvers: nextApprovers.map((a) => a.userName) },
    });
  }

  const [applied] = await db
    .update(approvals)
    .set({
      status: 'APPLIED',
      approvers: nextApprovers,
      appliedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(approvals.id, requestRow.id))
    .returning();

  const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, requestRow.flagId)).limit(1);
  const approvedCount = nextApprovers.filter((a) => a.decision === 'APPROVED').length;

  await db.insert(auditLogs).values({
    projectId: requestRow.projectId,
    environmentId: requestRow.environmentId,
    actorId,
    actorName,
    action: 'APPROVAL_APPLIED',
    entityType: 'FEATURE_FLAG',
    entityId: flag?.key || String(requestRow.flagId),
    summary: `Approved change (${approvedCount}/${requestRow.requiredApprovals}) applied to '${flag?.key}'`,
    beforeState: requestRow.currentSnapshot,
    afterState: requestRow.proposedChanges,
    traceId,
  });

  streamHub.broadcast(
    'flag:updated',
    {
      projectId: requestRow.projectId,
      environmentId: requestRow.environmentId,
      flagKey: flag?.key,
      approvalId: requestRow.id,
    },
    { projectId: requestRow.projectId, environmentId: requestRow.environmentId }
  );

  return applied;
}

export async function applyDueScheduledApprovals(): Promise<number> {
  const scheduledRows = await db.select().from(approvals).where(eq(approvals.status, 'SCHEDULED'));
  const now = Date.now();
  let appliedCount = 0;
  for (const row of scheduledRows) {
    if (!row.scheduledFor || row.scheduledFor.getTime() <= now) {
      await applyApprovedChange(row, row.requesterId, 'Scheduled Rollout Engine', row.approvers || [], `sched-${row.id}`);
      appliedCount++;
    }
  }
  return appliedCount;
}

// ---------------- SEGMENTS ----------------
governanceAnalyticsRouter.get('/projects/:projectId/segments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const rows = await db
      .select()
      .from(segments)
      .where(eq(segments.projectId, projectId))
      .orderBy(desc(segments.updatedAt));
    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('List segments failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to fetch segments.');
  }
});

governanceAnalyticsRouter.post('/projects/:projectId/segments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!(await enforceProjectPermission(req, res, projectId, ['ADMIN', 'EDITOR']))) return;

    const schema = z.object({
      key: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
      name: z.string().min(2).max(100),
      description: z.string().max(500).optional(),
      includedUsers: z.array(z.string()).default([]),
      excludedUsers: z.array(z.string()).default([]),
      ruleGroup: z.record(z.string(), z.unknown()),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Segment key must be kebab-case with a valid rule group.');
    }

    const [created] = await db
      .insert(segments)
      .values({
        projectId,
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || '',
        includedUsers: parsed.data.includedUsers,
        excludedUsers: parsed.data.excludedUsers,
        ruleGroup: parsed.data.ruleGroup,
        createdById: req.user!.id,
      })
      .returning();

    await db.insert(auditLogs).values({
      projectId,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'SEGMENT_CREATED',
      entityType: 'SEGMENT',
      entityId: created.key,
      summary: `Created segment '${created.name}'`,
      beforeState: null,
      afterState: { key: created.key },
      traceId: getTraceId(req),
    });

    streamHub.broadcast('flag:updated', { projectId, segmentKey: created.key }, { projectId });
    res.status(201).json(created);
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return sendProblem(req, res, 409, 'Conflict', 'A segment with this key already exists in the project.');
    }
    console.error('Create segment failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to create segment.');
  }
});

governanceAnalyticsRouter.put('/segments/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const segId = Number(req.params.id);
    const [existing] = await db.select().from(segments).where(eq(segments.id, segId)).limit(1);
    if (!existing) return sendProblem(req, res, 404, 'Not Found', 'Segment not found.');
    if (!(await enforceProjectPermission(req, res, existing.projectId, ['ADMIN', 'EDITOR']))) return;

    const [updated] = await db
      .update(segments)
      .set({
        name: typeof req.body.name === 'string' ? req.body.name : existing.name,
        description: typeof req.body.description === 'string' ? req.body.description : existing.description,
        includedUsers: Array.isArray(req.body.includedUsers) ? req.body.includedUsers : existing.includedUsers,
        excludedUsers: Array.isArray(req.body.excludedUsers) ? req.body.excludedUsers : existing.excludedUsers,
        ruleGroup: req.body.ruleGroup || existing.ruleGroup,
        updatedAt: new Date(),
      })
      .where(eq(segments.id, segId))
      .returning();

    streamHub.broadcast('flag:updated', { projectId: existing.projectId, segmentKey: updated.key }, { projectId: existing.projectId });
    res.json(updated);
  } catch (error) {
    console.error('Update segment failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to update segment.');
  }
});

governanceAnalyticsRouter.delete('/segments/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const segId = Number(req.params.id);
    const [existing] = await db.select().from(segments).where(eq(segments.id, segId)).limit(1);
    if (!existing) return sendProblem(req, res, 404, 'Not Found', 'Segment not found.');
    if (!(await enforceProjectPermission(req, res, existing.projectId, ['ADMIN', 'EDITOR']))) return;

    await db.delete(segments).where(eq(segments.id, segId));
    res.json({ deleted: true });
  } catch (error) {
    console.error('Delete segment failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to delete segment.');
  }
});

// ---------------- TWO-PERSON PRODUCTION APPROVAL WORKFLOW ----------------
governanceAnalyticsRouter.get('/projects/:projectId/approvals', requireAuth, async (req: AuthRequest, res) => {
  try {
    await applyDueScheduledApprovals();
    const projectId = Number(req.params.projectId);
    const rows = await db
      .select({
        id: approvals.id,
        projectId: approvals.projectId,
        flagId: approvals.flagId,
        flagKey: featureFlags.key,
        flagName: featureFlags.name,
        environmentId: approvals.environmentId,
        environmentName: environments.name,
        requesterId: approvals.requesterId,
        requesterName: users.fullName,
        status: approvals.status,
        requiredApprovals: approvals.requiredApprovals,
        approvers: approvals.approvers,
        reason: approvals.reason,
        currentSnapshot: approvals.currentSnapshot,
        proposedChanges: approvals.proposedChanges,
        scheduledFor: approvals.scheduledFor,
        appliedAt: approvals.appliedAt,
        createdAt: approvals.createdAt,
      })
      .from(approvals)
      .innerJoin(featureFlags, eq(approvals.flagId, featureFlags.id))
      .innerJoin(environments, eq(approvals.environmentId, environments.id))
      .leftJoin(users, eq(approvals.requesterId, users.id))
      .where(eq(approvals.projectId, projectId))
      .orderBy(desc(approvals.createdAt));

    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('List approvals failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to load approval requests.');
  }
});

governanceAnalyticsRouter.post('/approvals/:id/decision', requireAuth, async (req: AuthRequest, res) => {
  try {
    const approvalId = Number(req.params.id);
    const [requestRow] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
    if (!requestRow) return sendProblem(req, res, 404, 'Not Found', 'Approval request not found.');
    if (!(await enforceProjectPermission(req, res, requestRow.projectId, ['ADMIN', 'APPROVER']))) return;

    if (requestRow.status !== 'PENDING') {
      return sendProblem(req, res, 400, 'Already Resolved', `Approval is already in '${requestRow.status}' state.`);
    }

    const decision = req.body?.decision === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';

    // Two-person approval enforcement: requester cannot self-approve their own production change
    if (decision === 'APPROVED' && requestRow.requesterId === req.user!.id) {
      return sendProblem(
        req,
        res,
        403,
        'Two-Person Rule Violation',
        'The author of a production change cannot approve their own request. A different Approver or Admin must review it.'
      );
    }

    const existingApprovers = requestRow.approvers || [];
    if (existingApprovers.some((a) => a.userId === req.user!.id)) {
      return sendProblem(req, res, 409, 'Duplicate Review', 'You have already recorded a decision on this request.');
    }

    const nextApprovers = [
      ...existingApprovers,
      {
        userId: req.user!.id,
        userName: req.user!.fullName,
        decision: decision as 'APPROVED' | 'REJECTED',
        comment,
        decidedAt: new Date().toISOString(),
      },
    ];

    if (decision === 'REJECTED') {
      const [rejected] = await db
        .update(approvals)
        .set({ status: 'REJECTED', approvers: nextApprovers, updatedAt: new Date() })
        .where(eq(approvals.id, approvalId))
        .returning();

      await db.insert(auditLogs).values({
        projectId: requestRow.projectId,
        environmentId: requestRow.environmentId,
        actorId: req.user!.id,
        actorName: req.user!.fullName,
        action: 'APPROVAL_REJECTED',
        entityType: 'APPROVAL',
        entityId: String(approvalId),
        summary: `Rejected production change request #${approvalId}: ${comment || 'No comment'}`,
        beforeState: requestRow.currentSnapshot,
        afterState: requestRow.proposedChanges,
        traceId: getTraceId(req),
      });

      streamHub.broadcast('approval:updated', { projectId: requestRow.projectId, approvalId }, { projectId: requestRow.projectId });
      return res.json({ approval: rejected, applied: false });
    }

    const approvedCount = nextApprovers.filter((a) => a.decision === 'APPROVED').length;
    const isThresholdMet = approvedCount >= requestRow.requiredApprovals;

    if (!isThresholdMet) {
      const [partial] = await db
        .update(approvals)
        .set({ approvers: nextApprovers, updatedAt: new Date() })
        .where(eq(approvals.id, approvalId))
        .returning();

      await db.insert(auditLogs).values({
        projectId: requestRow.projectId,
        environmentId: requestRow.environmentId,
        actorId: req.user!.id,
        actorName: req.user!.fullName,
        action: 'APPROVAL_ENDORSED',
        entityType: 'APPROVAL',
        entityId: String(approvalId),
        summary: `Approved change request #${approvalId} (${approvedCount}/${requestRow.requiredApprovals})`,
        beforeState: { approvedCount: approvedCount - 1 },
        afterState: { approvedCount },
        traceId: getTraceId(req),
      });

      streamHub.broadcast('approval:updated', { projectId: requestRow.projectId, approvalId }, { projectId: requestRow.projectId });
      return res.json({ approval: partial, applied: false });
    }

    // Threshold reached! Check if rollout is scheduled for a future time
    if (requestRow.scheduledFor && requestRow.scheduledFor.getTime() > Date.now()) {
      const [scheduled] = await db
        .update(approvals)
        .set({
          status: 'SCHEDULED',
          approvers: nextApprovers,
          updatedAt: new Date(),
        })
        .where(eq(approvals.id, approvalId))
        .returning();

      await db.insert(auditLogs).values({
        projectId: requestRow.projectId,
        environmentId: requestRow.environmentId,
        actorId: req.user!.id,
        actorName: req.user!.fullName,
        action: 'APPROVAL_SCHEDULED',
        entityType: 'APPROVAL',
        entityId: String(approvalId),
        summary: `Quorum reached (${approvedCount}/${requestRow.requiredApprovals}); scheduled for ${requestRow.scheduledFor.toISOString()}`,
        beforeState: requestRow.currentSnapshot,
        afterState: requestRow.proposedChanges,
        traceId: getTraceId(req),
      });

      streamHub.broadcast('approval:updated', { projectId: requestRow.projectId, approvalId }, { projectId: requestRow.projectId });
      return res.json({ approval: scheduled, applied: false, scheduled: true });
    }

    const applied = await applyApprovedChange(
      requestRow,
      req.user!.id,
      req.user!.fullName,
      nextApprovers,
      getTraceId(req)
    );

    res.json({ approval: applied, applied: true, scheduled: false });
  } catch (error) {
    console.error('Approval decision failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to record approval decision.');
  }
});

// ---------------- AUDIT LOGS ----------------
governanceAnalyticsRouter.get('/projects/:projectId/audit-logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const actionFilter = typeof req.query.action === 'string' ? req.query.action : '';

    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.projectId, projectId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);

    const filtered = rows.filter((r) => {
      if (actionFilter && actionFilter !== 'ALL' && r.action !== actionFilter) return false;
      if (search) {
        const hay = `${r.actorName} ${r.action} ${r.entityId} ${r.summary} ${r.traceId}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({ data: filtered, total: filtered.length });
  } catch (error) {
    console.error('Audit logs failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to fetch audit logs.');
  }
});

// ---------------- FLAG HYGIENE ----------------
governanceAnalyticsRouter.get('/projects/:projectId/hygiene', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const envId = req.query.environmentId ? Number(req.query.environmentId) : undefined;

    const projFlags = await db
      .select({
        id: featureFlags.id,
        key: featureFlags.key,
        name: featureFlags.name,
        flagType: featureFlags.flagType,
        archived: featureFlags.archived,
        ownerName: users.fullName,
        ownerEmail: users.email,
      })
      .from(featureFlags)
      .leftJoin(users, eq(featureFlags.ownerId, users.id))
      .where(and(eq(featureFlags.projectId, projectId), eq(featureFlags.archived, false)));

    const flagIds = projFlags.map((f) => f.id);
    const configs =
      flagIds.length > 0
        ? await db.select().from(rolloutConfigurations).where(inArray(rolloutConfigurations.flagId, flagIds))
        : [];
    const projEnvs = await db.select().from(environments).where(eq(environments.projectId, projectId));
    const targetEnvId = envId || projEnvs.find((e) => e.key === 'production')?.id || projEnvs[0]?.id;

    const now = Date.now();
    const staleItems: Array<Record<string, unknown>> = [];

    for (const f of projFlags) {
      const cfg = configs.find((c) => c.flagId === f.id && c.environmentId === targetEnvId);
      if (!cfg) continue;

      const daysSinceEval = cfg.lastEvaluatedAt
        ? Math.floor((now - cfg.lastEvaluatedAt.getTime()) / 86400000)
        : 999;
      const daysAtFull =
        cfg.rolloutPercentage === 100 && cfg.fullRolloutSince
          ? Math.floor((now - cfg.fullRolloutSince.getTime()) / 86400000)
          : 0;

      if (daysSinceEval >= 30) {
        staleItems.push({
          flagId: f.id,
          flagKey: f.key,
          flagName: f.name,
          ownerName: f.ownerName || 'Unassigned',
          reasonType: 'UNUSED_30_DAYS',
          reasonLabel: `Not evaluated for ${daysSinceEval} days`,
          lastEvaluatedAt: cfg.lastEvaluatedAt,
          rolloutPercentage: cfg.rolloutPercentage,
          suggestedAction: 'Remove dead flag references in code and archive flag.',
        });
      } else if (daysAtFull >= 14) {
        staleItems.push({
          flagId: f.id,
          flagKey: f.key,
          flagName: f.name,
          ownerName: f.ownerName || 'Unassigned',
          reasonType: 'FULL_ROLLOUT_14_DAYS',
          reasonLabel: `100% rolled out for ${daysAtFull} days`,
          lastEvaluatedAt: cfg.lastEvaluatedAt,
          rolloutPercentage: cfg.rolloutPercentage,
          suggestedAction: 'Promote winning variation permanently into codebase and archive flag.',
        });
      }
    }

    res.json({ data: staleItems, total: staleItems.length });
  } catch (error) {
    console.error('Hygiene fetch failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to inspect flag hygiene.');
  }
});

governanceAnalyticsRouter.post('/flags/:flagId/archive', requireAuth, async (req: AuthRequest, res) => {
  try {
    const flagId = Number(req.params.flagId);
    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, flagId)).limit(1);
    if (!flag) return sendProblem(req, res, 404, 'Not Found', 'Feature flag not found.');
    if (!(await enforceProjectPermission(req, res, flag.projectId, ['ADMIN', 'EDITOR']))) return;

    await db.update(featureFlags).set({ archived: true, updatedAt: new Date() }).where(eq(featureFlags.id, flagId));
    await db.insert(auditLogs).values({
      projectId: flag.projectId,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'FLAG_ARCHIVED',
      entityType: 'FEATURE_FLAG',
      entityId: flag.key,
      summary: `Archived stale feature flag '${flag.key}' via Flag Hygiene`,
      beforeState: { archived: false },
      afterState: { archived: true },
      traceId: getTraceId(req),
    });

    res.json({ archived: true, flagId });
  } catch (error) {
    console.error('Archive flag failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to archive flag.');
  }
});

// ---------------- EXPERIMENTS & ANALYTICS ----------------
governanceAnalyticsRouter.get('/projects/:projectId/experiments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const expRows = await db
      .select({
        id: experiments.id,
        projectId: experiments.projectId,
        flagId: experiments.flagId,
        flagKey: featureFlags.key,
        flagName: featureFlags.name,
        environmentId: experiments.environmentId,
        environmentName: environments.name,
        name: experiments.name,
        hypothesis: experiments.hypothesis,
        primaryMetric: experiments.primaryMetric,
        status: experiments.status,
        trafficAllocation: experiments.trafficAllocation,
        startedAt: experiments.startedAt,
        endedAt: experiments.endedAt,
        createdAt: experiments.createdAt,
      })
      .from(experiments)
      .innerJoin(featureFlags, eq(experiments.flagId, featureFlags.id))
      .innerJoin(environments, eq(experiments.environmentId, environments.id))
      .where(eq(experiments.projectId, projectId))
      .orderBy(desc(experiments.createdAt));

    const expIds = expRows.map((e) => e.id);
    const vars =
      expIds.length > 0
        ? await db.select().from(experimentVariations).where(inArray(experimentVariations.experimentId, expIds))
        : [];
    const exps =
      expIds.length > 0
        ? await db.select().from(exposureEvents).where(inArray(exposureEvents.experimentId, expIds))
        : [];
    const goals =
      expIds.length > 0
        ? await db.select().from(goalEvents).where(inArray(goalEvents.experimentId, expIds))
        : [];

    const data = expRows.map((e) => {
      const myVars = vars.filter((v) => v.experimentId === e.id);
      const myExps = exps.filter((x) => x.experimentId === e.id);
      const myGoals = goals.filter((g) => g.experimentId === e.id);
      const report = analyzeExperiment(
        myVars.map((v) => ({
          variationKey: v.variationKey,
          name: v.name,
          isControl: v.isControl,
          expectedWeight: v.expectedWeight,
          exposures: myExps.filter((x) => x.variationKey === v.variationKey).length,
          conversions: myGoals.filter((g) => g.variationKey === v.variationKey).length,
        }))
      );
      return { ...e, report };
    });

    res.json({ data, total: data.length });
  } catch (error) {
    console.error('List experiments failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to fetch experiments.');
  }
});

governanceAnalyticsRouter.post('/projects/:projectId/experiments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!(await enforceProjectPermission(req, res, projectId, ['ADMIN', 'EDITOR']))) return;

    const schema = z.object({
      flagId: z.number().int().positive(),
      environmentId: z.number().int().positive(),
      name: z.string().min(3).max(120),
      hypothesis: z.string().max(600).default(''),
      primaryMetric: z.string().min(2).max(80),
      trafficAllocation: z.number().int().min(1).max(100).default(100),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Provide valid experiment name, flag, environment, and primary metric.');
    }

    const vars = await db
      .select()
      .from(flagVariations)
      .where(eq(flagVariations.flagId, parsed.data.flagId))
      .orderBy(flagVariations.sortOrder);

    if (vars.length < 2) {
      return sendProblem(req, res, 400, 'Insufficient Variations', 'Flag must have at least 2 variations to run an experiment.');
    }

    const [created] = await db
      .insert(experiments)
      .values({
        projectId,
        flagId: parsed.data.flagId,
        environmentId: parsed.data.environmentId,
        name: parsed.data.name,
        hypothesis: parsed.data.hypothesis,
        primaryMetric: parsed.data.primaryMetric,
        status: 'RUNNING',
        trafficAllocation: parsed.data.trafficAllocation,
        createdById: req.user!.id,
        startedAt: new Date(),
      })
      .returning();

    const equalWeight = Math.floor(100 / vars.length);
    await db.insert(experimentVariations).values(
      vars.map((v, i) => ({
        experimentId: created.id,
        variationKey: v.variationKey,
        name: v.name,
        isControl: i === 0,
        expectedWeight: i === 0 ? 100 - equalWeight * (vars.length - 1) : equalWeight,
      }))
    );

    await db.insert(auditLogs).values({
      projectId,
      environmentId: parsed.data.environmentId,
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: 'EXPERIMENT_CREATED',
      entityType: 'EXPERIMENT',
      entityId: String(created.id),
      summary: `Launched experiment '${created.name}' tracking '${created.primaryMetric}'`,
      beforeState: null,
      afterState: { name: created.name, primaryMetric: created.primaryMetric },
      traceId: getTraceId(req),
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create experiment failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to create experiment.');
  }
});

governanceAnalyticsRouter.patch('/experiments/:id/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const expId = Number(req.params.id);
    const [exp] = await db.select().from(experiments).where(eq(experiments.id, expId)).limit(1);
    if (!exp) return sendProblem(req, res, 404, 'Not Found', 'Experiment not found.');
    if (!(await enforceProjectPermission(req, res, exp.projectId, ['ADMIN', 'EDITOR']))) return;

    const status = z.enum(['DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED']).safeParse(req.body?.status);
    if (!status.success) return sendProblem(req, res, 400, 'Validation Failed', 'Invalid experiment status.');

    const [updated] = await db
      .update(experiments)
      .set({
        status: status.data,
        startedAt: status.data === 'RUNNING' && !exp.startedAt ? new Date() : exp.startedAt,
        endedAt: status.data === 'COMPLETED' ? new Date() : exp.endedAt,
      })
      .where(eq(experiments.id, expId))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error('Update experiment status failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to update experiment status.');
  }
});

governanceAnalyticsRouter.post('/experiments/:id/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    const expId = Number(req.params.id);
    const [exp] = await db.select().from(experiments).where(eq(experiments.id, expId)).limit(1);
    if (!exp) return sendProblem(req, res, 404, 'Not Found', 'Experiment not found.');

    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, exp.flagId)).limit(1);
    const schema = z.object({
      variationKey: z.string().min(1),
      exposures: z.number().int().min(1).max(200).default(1),
      conversions: z.number().int().min(0).max(200).default(0),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || parsed.data.conversions > parsed.data.exposures) {
      return sendProblem(req, res, 400, 'Validation Failed', 'Conversions cannot exceed exposures (max batch 200).');
    }

    const batchTag = Date.now();
    const expValues = Array.from({ length: parsed.data.exposures }, (_, i) => ({
      experimentId: exp.id,
      flagKey: flag?.key || 'flag',
      userKey: `evt-${batchTag}-${i}`,
      variationKey: parsed.data.variationKey,
    }));
    await db.insert(exposureEvents).values(expValues);

    if (parsed.data.conversions > 0) {
      const goalValues = Array.from({ length: parsed.data.conversions }, (_, i) => ({
        experimentId: exp.id,
        metricName: exp.primaryMetric,
        userKey: `evt-${batchTag}-${i}`,
        variationKey: parsed.data.variationKey,
        value: 1,
      }));
      await db.insert(goalEvents).values(goalValues);
    }

    streamHub.recordExperimentEvent(parsed.data.exposures + parsed.data.conversions);
    res.status(201).json({ recordedExposures: parsed.data.exposures, recordedConversions: parsed.data.conversions });
  } catch (error) {
    console.error('Record experiment events failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to record experiment events.');
  }
});

// ---------------- REAL-TIME SSE STREAM & SDK ENDPOINTS ----------------
async function buildEnvironmentSnapshotPayload(envRow: typeof environments.$inferSelect) {
  const [proj] = await db.select().from(projects).where(eq(projects.id, envRow.projectId)).limit(1);
  const projFlags = await db
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.projectId, envRow.projectId), eq(featureFlags.archived, false)));

  const flagIds = projFlags.map((f) => f.id);
  const variations =
    flagIds.length > 0 ? await db.select().from(flagVariations).where(inArray(flagVariations.flagId, flagIds)) : [];
  const configs =
    flagIds.length > 0
      ? await db
          .select()
          .from(rolloutConfigurations)
          .where(and(inArray(rolloutConfigurations.flagId, flagIds), eq(rolloutConfigurations.environmentId, envRow.id)))
      : [];
  const rules =
    flagIds.length > 0
      ? await db
          .select()
          .from(targetingRules)
          .where(and(inArray(targetingRules.flagId, flagIds), eq(targetingRules.environmentId, envRow.id)))
      : [];
  const segRows = await db.select().from(segments).where(eq(segments.projectId, envRow.projectId));

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

  const flagsMap: Record<string, FlagEnvironmentSnapshot> = {};
  for (const f of projFlags) {
    const cfg = configs.find((c) => c.flagId === f.id);
    const fVars = variations
      .filter((v) => v.flagId === f.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => ({
        variationKey: v.variationKey,
        name: v.name,
        value: v.valueJson,
        description: v.description,
      }));
    flagsMap[f.key] = {
      flagKey: f.key,
      flagType: f.flagType as FlagType,
      offVariationKey: f.offVariationKey,
      defaultVariationKey: f.defaultVariationKey,
      variations: fVars,
      enabled: cfg?.enabled ?? false,
      killSwitch: cfg?.killSwitch ?? false,
      envDefaultVariationKey: cfg?.defaultVariationKey ?? f.defaultVariationKey,
      rolloutVariationKey: cfg?.rolloutVariationKey ?? fVars[1]?.variationKey ?? f.defaultVariationKey,
      rolloutPercentage: cfg?.rolloutPercentage ?? 0,
      rolloutWeights: cfg?.rolloutWeights ?? [],
      individualTargets: cfg?.individualTargets ?? {},
      rules: rules
        .filter((r) => r.flagId === f.id)
        .sort((a, b) => a.priority - b.priority)
        .map((r) => ({
          id: r.id,
          name: r.name,
          priority: r.priority,
          segmentKey: r.segmentKey,
          ruleGroup: r.ruleGroup as unknown as RuleGroup,
          serveVariationKey: r.serveVariationKey,
          enabled: r.enabled,
        })),
      version: cfg?.version ?? 1,
    };
  }

  return {
    projectKey: proj?.key || 'unknown',
    environmentKey: envRow.key,
    generatedAt: new Date().toISOString(),
    flags: flagsMap,
    segments: segmentsMap,
  };
}

governanceAnalyticsRouter.get('/sdk/snapshot', async (req, res) => {
  try {
    const sdkKey = (req.header('x-flagship-sdk-key') || String(req.query.sdkKey || '')).trim();
    if (!sdkKey) return sendProblem(req, res, 401, 'Missing SDK Key', 'Supply X-FlagShip-SDK-Key header or sdkKey query parameter.');

    const keyHash = hashSecret(sdkKey);
    const [envRow] = await db.select().from(environments).where(eq(environments.sdkKeyHash, keyHash)).limit(1);
    if (!envRow) return sendProblem(req, res, 401, 'Invalid SDK Key', 'SDK key not recognized.');

    const payload = await buildEnvironmentSnapshotPayload(envRow);
    res.json(payload);
  } catch (error) {
    console.error('SDK snapshot failed:', error);
    sendProblem(req, res, 500, 'Internal Server Error', 'Unable to build SDK snapshot.');
  }
});

governanceAnalyticsRouter.get('/sdk/stream', async (req, res) => {
  try {
    const sdkKey = (req.header('x-flagship-sdk-key') || String(req.query.sdkKey || '')).trim();
    if (!sdkKey) return sendProblem(req, res, 401, 'Missing SDK Key', 'Supply sdkKey to connect to SSE stream.');

    const keyHash = hashSecret(sdkKey);
    const [envRow] = await db.select().from(environments).where(eq(environments.sdkKeyHash, keyHash)).limit(1);
    if (!envRow) return sendProblem(req, res, 401, 'Invalid SDK Key', 'SDK key not recognized.');

    streamHub.registerClient(res, {
      projectId: envRow.projectId,
      environmentId: envRow.id,
      sdkKeyPrefix: envRow.sdkKeyPrefix,
    });

    const payload = await buildEnvironmentSnapshotPayload(envRow);
    res.write(`event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch (error) {
    console.error('SDK SSE failed:', error);
    if (!res.headersSent) {
      sendProblem(req, res, 500, 'Internal Server Error', 'Unable to open SSE stream.');
    }
  }
});

governanceAnalyticsRouter.get('/stream', requireAuth, (req: AuthRequest, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
  const environmentId = req.query.environmentId ? Number(req.query.environmentId) : undefined;
  streamHub.registerClient(res, { projectId, environmentId });
});

// ---------------- ACTUATOR, OBSERVABILITY & OPENAPI ----------------
governanceAnalyticsRouter.get('/actuator/health', (_req, res) => {
  res.json({
    status: 'UP',
    components: {
      db: { status: 'UP', engine: dbEngineMode },
      sseHub: { status: 'UP' },
    },
  });
});

governanceAnalyticsRouter.get('/actuator/health/readiness', (_req, res) => {
  res.json({ status: 'UP', readiness: 'ACCEPTING_TRAFFIC' });
});

governanceAnalyticsRouter.get('/actuator/metrics', (_req, res) => {
  res.json(streamHub.getMetricsSnapshot());
});

governanceAnalyticsRouter.get('/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'FlagShip Enterprise Feature Flag & Gradual Rollout API',
      version: '1.0.0',
      description: 'REST, SSE, and SDK Evaluation API with RFC 9457 Problem Details and Project-Level RBAC.',
    },
    paths: {
      '/api/auth/login': { post: { summary: 'Authenticate with email/password and obtain JWT + refresh token' } },
      '/api/auth/register': { post: { summary: 'Register a new user account' } },
      '/api/auth/refresh': { post: { summary: 'Rotate refresh token and issue new access JWT' } },
      '/api/dashboard': { get: { summary: 'Real-time dashboard KPIs, charts, and environment summaries' } },
      '/api/projects': { get: { summary: 'List projects' }, post: { summary: 'Create project with Dev/Staging/Prod environments' } },
      '/api/projects/{projectId}/flags': { get: { summary: 'List feature flags' }, post: { summary: 'Create feature flag' } },
      '/api/flags/{flagId}/environments/{envId}/config': { post: { summary: 'Update targeting/rollout/kill-switch or queue 2-person approval' } },
      '/api/flags/{flagId}/environments/{envId}/evaluate': { post: { summary: 'Live deterministic evaluation preview' } },
      '/api/projects/{projectId}/segments': { get: { summary: 'List audience segments' }, post: { summary: 'Create audience segment' } },
      '/api/projects/{projectId}/approvals': { get: { summary: 'List production approval requests' } },
      '/api/approvals/{id}/decision': { post: { summary: 'Approve or reject a production change (2-person rule)' } },
      '/api/projects/{projectId}/experiments': { get: { summary: 'List experiments with Z-test & SRM analytics' }, post: { summary: 'Launch experiment' } },
      '/api/projects/{projectId}/hygiene': { get: { summary: 'Detect stale (>30d unused or >14d 100%) flags' } },
      '/api/sdk/snapshot': { get: { summary: 'Fetch signed environment snapshot for Java/TS SDKs' } },
      '/api/sdk/stream': { get: { summary: 'Server-Sent Events push channel for instant flag & kill-switch propagation' } },
      '/api/actuator/health': { get: { summary: 'Health & readiness status' } },
      '/api/actuator/metrics': { get: { summary: 'Evaluation latency, cache hit/miss, and SSE connection metrics' } },
    },
  });
});
