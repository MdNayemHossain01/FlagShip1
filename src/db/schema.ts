import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Users (supports both Firebase Auth UID and JWT email/password auth)
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').unique(),
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash'),
    role: text('role').notNull().default('VIEWER'), // ADMIN | EDITOR | APPROVER | VIEWER
    avatarInitials: text('avatar_initials').notNull().default('FS'),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_users_email').on(table.email)]
);

// 2. Refresh Tokens (rotation & revocation)
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    revoked: boolean('revoked').notNull().default(false),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_refresh_tokens_user').on(table.userId)]
);

// 3. Projects
export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_projects_key').on(table.key)]
);

// 4. Project Members (Project-level RBAC)
export const projectMembers = pgTable(
  'project_members',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('VIEWER'), // ADMIN | EDITOR | APPROVER | VIEWER
    addedAt: timestamp('added_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_project_member').on(table.projectId, table.userId),
    index('idx_project_members_user').on(table.userId),
  ]
);

// 5. Environments (Development, Staging, Production + custom)
export const environments = pgTable(
  'environments',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull().default('#2563EB'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    requiredApprovers: integer('required_approvers').notNull().default(2),
    sdkKeyHash: text('sdk_key_hash').notNull(),
    sdkKeyPrefix: text('sdk_key_prefix').notNull(),
    sdkKeyPlainPreview: text('sdk_key_plain_preview').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_env_project_key').on(table.projectId, table.key),
    index('idx_env_project').on(table.projectId),
  ]
);

// 6. Feature Flags
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    flagType: text('flag_type').notNull().default('BOOLEAN'), // BOOLEAN | STRING | NUMBER | JSON
    ownerId: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
    defaultVariationKey: text('default_variation_key').notNull().default('off'),
    offVariationKey: text('off_variation_key').notNull().default('off'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_flag_project_key').on(table.projectId, table.key),
    index('idx_flags_project').on(table.projectId),
    index('idx_flags_owner').on(table.ownerId),
  ]
);

// 7. Flag Variations (Normalized per flag)
export const flagVariations = pgTable(
  'flag_variations',
  {
    id: serial('id').primaryKey(),
    flagId: integer('flag_id')
      .references(() => featureFlags.id, { onDelete: 'cascade' })
      .notNull(),
    variationKey: text('variation_key').notNull(),
    name: text('name').notNull(),
    valueJson: jsonb('value_json').$type<unknown>().notNull(),
    description: text('description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('uq_flag_variation_key').on(table.flagId, table.variationKey),
    index('idx_variations_flag').on(table.flagId),
  ]
);

// 8. Segments (Reusable user audience definitions per project)
export const segments = pgTable(
  'segments',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    includedUsers: jsonb('included_users').$type<string[]>().notNull().default([]),
    excludedUsers: jsonb('excluded_users').$type<string[]>().notNull().default([]),
    ruleGroup: jsonb('rule_group').$type<Record<string, unknown>>().notNull(),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_segment_project_key').on(table.projectId, table.key),
    index('idx_segments_project').on(table.projectId),
  ]
);

// 9. Rollout Configurations & Per-Environment Flag Configs
export const rolloutConfigurations = pgTable(
  'rollout_configurations',
  {
    id: serial('id').primaryKey(),
    flagId: integer('flag_id')
      .references(() => featureFlags.id, { onDelete: 'cascade' })
      .notNull(),
    environmentId: integer('environment_id')
      .references(() => environments.id, { onDelete: 'cascade' })
      .notNull(),
    enabled: boolean('enabled').notNull().default(false),
    killSwitch: boolean('kill_switch').notNull().default(false),
    defaultVariationKey: text('default_variation_key').notNull().default('off'),
    rolloutVariationKey: text('rollout_variation_key').notNull().default('on'),
    rolloutPercentage: integer('rollout_percentage').notNull().default(0), // 0..100
    rolloutWeights: jsonb('rollout_weights')
      .$type<Array<{ variationKey: string; weight: number }>>()
      .notNull()
      .default([]),
    individualTargets: jsonb('individual_targets')
      .$type<Record<string, string>>()
      .notNull()
      .default({}), // userKey -> variationKey
    version: integer('version').notNull().default(1),
    evaluationCount: integer('evaluation_count').notNull().default(0),
    lastEvaluatedAt: timestamp('last_evaluated_at'),
    fullRolloutSince: timestamp('full_rollout_since'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_rollout_flag_env').on(table.flagId, table.environmentId),
    index('idx_rollout_env').on(table.environmentId),
  ]
);

// 10. Targeting Rules (Ordered per flag & environment)
export const targetingRules = pgTable(
  'targeting_rules',
  {
    id: serial('id').primaryKey(),
    flagId: integer('flag_id')
      .references(() => featureFlags.id, { onDelete: 'cascade' })
      .notNull(),
    environmentId: integer('environment_id')
      .references(() => environments.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    priority: integer('priority').notNull().default(0),
    segmentKey: text('segment_key'),
    ruleGroup: jsonb('rule_group').$type<Record<string, unknown>>().notNull(),
    serveVariationKey: text('serve_variation_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_targeting_flag_env').on(table.flagId, table.environmentId)]
);

// 11. Flag Versions (Immutable history + diff + restore)
export const flagVersions = pgTable(
  'flag_versions',
  {
    id: serial('id').primaryKey(),
    flagId: integer('flag_id')
      .references(() => featureFlags.id, { onDelete: 'cascade' })
      .notNull(),
    environmentId: integer('environment_id')
      .references(() => environments.id, { onDelete: 'cascade' })
      .notNull(),
    versionNumber: integer('version_number').notNull(),
    authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    changeReason: text('change_reason').notNull().default('Configuration update'),
    snapshotJson: jsonb('snapshot_json').$type<Record<string, unknown>>().notNull(),
    diffJson: jsonb('diff_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_versions_flag_env').on(table.flagId, table.environmentId),
  ]
);

// 12. Approvals (Two-person production workflow + scheduled changes)
export const approvals = pgTable(
  'approvals',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    flagId: integer('flag_id')
      .references(() => featureFlags.id, { onDelete: 'cascade' })
      .notNull(),
    environmentId: integer('environment_id')
      .references(() => environments.id, { onDelete: 'cascade' })
      .notNull(),
    requesterId: integer('requester_id')
      .references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('PENDING'), // PENDING | APPROVED | REJECTED | APPLIED | SCHEDULED
    requiredApprovals: integer('required_approvals').notNull().default(2),
    approvers: jsonb('approvers')
      .$type<Array<{ userId: number; userName: string; decision: 'APPROVED' | 'REJECTED'; comment: string; decidedAt: string }>>()
      .notNull()
      .default([]),
    reason: text('reason').notNull(),
    currentSnapshot: jsonb('current_snapshot').$type<Record<string, unknown>>().notNull(),
    proposedChanges: jsonb('proposed_changes').$type<Record<string, unknown>>().notNull(),
    scheduledFor: timestamp('scheduled_for'),
    appliedAt: timestamp('applied_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_approvals_project_status').on(table.projectId, table.status),
  ]
);

// 13. Audit Logs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    environmentId: integer('environment_id').references(() => environments.id, { onDelete: 'set null' }),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull().default('System'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary').notNull(),
    beforeState: jsonb('before_state').$type<Record<string, unknown> | null>(),
    afterState: jsonb('after_state').$type<Record<string, unknown> | null>(),
    traceId: text('trace_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_project_created').on(table.projectId, table.createdAt),
  ]
);

// 14. Experiments
export const experiments = pgTable(
  'experiments',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    flagId: integer('flag_id')
      .references(() => featureFlags.id, { onDelete: 'cascade' })
      .notNull(),
    environmentId: integer('environment_id')
      .references(() => environments.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    hypothesis: text('hypothesis').notNull().default(''),
    primaryMetric: text('primary_metric').notNull().default('checkout_completed'),
    status: text('status').notNull().default('DRAFT'), // DRAFT | RUNNING | PAUSED | COMPLETED
    trafficAllocation: integer('traffic_allocation').notNull().default(100),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_experiments_project').on(table.projectId)]
);

// 15. Experiment Variations
export const experimentVariations = pgTable(
  'experiment_variations',
  {
    id: serial('id').primaryKey(),
    experimentId: integer('experiment_id')
      .references(() => experiments.id, { onDelete: 'cascade' })
      .notNull(),
    variationKey: text('variation_key').notNull(),
    name: text('name').notNull(),
    isControl: boolean('is_control').notNull().default(false),
    expectedWeight: integer('expected_weight').notNull().default(50),
  },
  (table) => [index('idx_exp_vars_experiment').on(table.experimentId)]
);

// 16. Exposure Events
export const exposureEvents = pgTable(
  'exposure_events',
  {
    id: serial('id').primaryKey(),
    experimentId: integer('experiment_id')
      .references(() => experiments.id, { onDelete: 'cascade' })
      .notNull(),
    flagKey: text('flag_key').notNull(),
    userKey: text('user_key').notNull(),
    variationKey: text('variation_key').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_exposure_exp_var').on(table.experimentId, table.variationKey)]
);

// 17. Goal / Conversion Events
export const goalEvents = pgTable(
  'goal_events',
  {
    id: serial('id').primaryKey(),
    experimentId: integer('experiment_id')
      .references(() => experiments.id, { onDelete: 'cascade' })
      .notNull(),
    metricName: text('metric_name').notNull(),
    userKey: text('user_key').notNull(),
    variationKey: text('variation_key').notNull(),
    value: real('value').notNull().default(1),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_goal_exp_var').on(table.experimentId, table.variationKey)]
);

// Relations
export const projectsRelations = relations(projects, ({ many }) => ({
  environments: many(environments),
  flags: many(featureFlags),
  members: many(projectMembers),
  segments: many(segments),
  experiments: many(experiments),
}));

export const featureFlagsRelations = relations(featureFlags, ({ one, many }) => ({
  project: one(projects, { fields: [featureFlags.projectId], references: [projects.id] }),
  owner: one(users, { fields: [featureFlags.ownerId], references: [users.id] }),
  variations: many(flagVariations),
  rollouts: many(rolloutConfigurations),
  rules: many(targetingRules),
  versions: many(flagVersions),
}));
