import crypto from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { db, ensureDatabaseReady } from '../db/index.ts';
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
  projectMembers,
  projects,
  rolloutConfigurations,
  segments,
  targetingRules,
  users,
} from '../db/schema.ts';
import { hashPassword, hashSecret } from './auth.ts';

let seedPromise: Promise<void> | null = null;

function generateSdkKey(envKey: string) {
  const token = crypto.randomBytes(18).toString('hex');
  const raw = `fs_${envKey.slice(0, 4)}_${token}`;
  return {
    raw,
    hash: hashSecret(raw),
    prefix: raw.slice(0, 14),
    preview: `${raw.slice(0, 14)}••••${raw.slice(-4)}`,
  };
}

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeedIfNeeded().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeedIfNeeded(): Promise<void> {
  await ensureDatabaseReady();
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  if (userCount > 0) return;

  const demoPasswordHash = await hashPassword('FlagShip2026!');

  // 1. Seed 4 RBAC Demo Users
  const insertedUsers = await db
    .insert(users)
    .values([
      {
        email: 'admin@flagship.dev',
        fullName: 'Aria Chen',
        passwordHash: demoPasswordHash,
        role: 'ADMIN',
        avatarInitials: 'AC',
        active: true,
        lastLoginAt: new Date(),
      },
      {
        email: 'editor@flagship.dev',
        fullName: 'Marcus Vance',
        passwordHash: demoPasswordHash,
        role: 'EDITOR',
        avatarInitials: 'MV',
        active: true,
        lastLoginAt: new Date(Date.now() - 3600 * 1000 * 2),
      },
      {
        email: 'approver@flagship.dev',
        fullName: 'Priya Nair',
        passwordHash: demoPasswordHash,
        role: 'APPROVER',
        avatarInitials: 'PN',
        active: true,
        lastLoginAt: new Date(Date.now() - 3600 * 1000 * 5),
      },
      {
        email: 'viewer@flagship.dev',
        fullName: 'David Okafor',
        passwordHash: demoPasswordHash,
        role: 'VIEWER',
        avatarInitials: 'DO',
        active: true,
        lastLoginAt: new Date(Date.now() - 3600 * 1000 * 14),
      },
    ])
    .returning();

  const [adminUser, editorUser, approverUser, viewerUser] = insertedUsers;

  // 2. Seed 2 Enterprise Projects
  const insertedProjects = await db
    .insert(projects)
    .values([
      {
        key: 'commerce-core',
        name: 'Commerce Core Platform',
        description: 'Checkout, payments, pricing, and storefront experimentation flags for global retail.',
        createdById: adminUser.id,
      },
      {
        key: 'mobile-banking',
        name: 'Mobile Banking Suite',
        description: 'iOS and Android retail banking releases, biometric auth, and real-time fraud guardrails.',
        createdById: adminUser.id,
      },
    ])
    .returning();

  const [commerceProj, bankingProj] = insertedProjects;

  // Project Memberships
  await db.insert(projectMembers).values([
    { projectId: commerceProj.id, userId: adminUser.id, role: 'ADMIN' },
    { projectId: commerceProj.id, userId: editorUser.id, role: 'EDITOR' },
    { projectId: commerceProj.id, userId: approverUser.id, role: 'APPROVER' },
    { projectId: commerceProj.id, userId: viewerUser.id, role: 'VIEWER' },
    { projectId: bankingProj.id, userId: adminUser.id, role: 'ADMIN' },
    { projectId: bankingProj.id, userId: editorUser.id, role: 'EDITOR' },
    { projectId: bankingProj.id, userId: approverUser.id, role: 'APPROVER' },
  ]);

  // 3. Seed Default Environments (Development, Staging, Production) for both projects
  const envDefs = [
    { projectId: commerceProj.id, key: 'development', name: 'Development', color: '#0EA5E9', requiresApproval: false, requiredApprovers: 1 },
    { projectId: commerceProj.id, key: 'staging', name: 'Staging', color: '#D97706', requiresApproval: false, requiredApprovers: 1 },
    { projectId: commerceProj.id, key: 'production', name: 'Production', color: '#DC2626', requiresApproval: true, requiredApprovers: 2 },
    { projectId: bankingProj.id, key: 'development', name: 'Development', color: '#0EA5E9', requiresApproval: false, requiredApprovers: 1 },
    { projectId: bankingProj.id, key: 'staging', name: 'Staging', color: '#D97706', requiresApproval: false, requiredApprovers: 1 },
    { projectId: bankingProj.id, key: 'production', name: 'Production', color: '#DC2626', requiresApproval: true, requiredApprovers: 2 },
  ];

  const insertedEnvs = await db
    .insert(environments)
    .values(
      envDefs.map((e) => {
        const sdk = generateSdkKey(e.key);
        return {
          ...e,
          sdkKeyHash: sdk.hash,
          sdkKeyPrefix: sdk.prefix,
          sdkKeyPlainPreview: sdk.raw,
        };
      })
    )
    .returning();

  const commDev = insertedEnvs[0];
  const commStage = insertedEnvs[1];
  const commProd = insertedEnvs[2];
  const bankDev = insertedEnvs[3];
  const bankStage = insertedEnvs[4];
  const bankProd = insertedEnvs[5];

  // 4. Seed Segments
  await db.insert(segments).values([
    {
      projectId: commerceProj.id,
      key: 'beta-testers',
      name: 'Internal & Beta Cohort',
      description: 'QA engineers and opted-in early adopters across US and Canada.',
      includedUsers: ['qa-alice', 'pm-aria', 'staff-marcus'],
      excludedUsers: ['blocked-bot-01'],
      ruleGroup: {
        type: 'group',
        combinator: 'AND',
        children: [
          { type: 'condition', attribute: 'email', operator: 'ENDS_WITH', value: '@flagship.dev' },
          { type: 'condition', attribute: 'country', operator: 'IN', value: ['US', 'CA', 'GB'] },
        ],
      },
      createdById: adminUser.id,
    },
    {
      projectId: commerceProj.id,
      key: 'enterprise-tier',
      name: 'Enterprise High-Value Customers',
      description: 'Enterprise tier accounts on app v2.2.0 or newer.',
      includedUsers: ['acct-enterprise-01'],
      excludedUsers: [],
      ruleGroup: {
        type: 'group',
        combinator: 'AND',
        children: [
          { type: 'condition', attribute: 'plan', operator: 'EQUALS', value: 'enterprise' },
          { type: 'condition', attribute: 'appVersion', operator: 'SEMVER_GT', value: '2.1.0' },
        ],
      },
      createdById: editorUser.id,
    },
    {
      projectId: bankingProj.id,
      key: 'biometric-capable',
      name: 'Biometric iOS/Android v4+',
      description: 'Devices running mobile client v4.0.0+ with hardware enclave.',
      includedUsers: [],
      excludedUsers: [],
      ruleGroup: {
        type: 'group',
        combinator: 'AND',
        children: [
          { type: 'condition', attribute: 'appVersion', operator: 'SEMVER_GT', value: '3.9.9' },
          { type: 'condition', attribute: 'platform', operator: 'IN', value: ['ios', 'android'] },
        ],
      },
      createdById: adminUser.id,
    },
  ]);

  // 5. Seed 7 Feature Flags across all 4 types (BOOLEAN, STRING, NUMBER, JSON)
  const flagsSeed = await db
    .insert(featureFlags)
    .values([
      {
        projectId: commerceProj.id,
        key: 'new-checkout',
        name: 'One-Click Express Checkout',
        description: 'Streamlined single-page checkout flow with tokenized payment rails.',
        flagType: 'BOOLEAN',
        ownerId: adminUser.id,
        defaultVariationKey: 'off',
        offVariationKey: 'off',
        tags: ['checkout', 'revenue', 'q4-launch'],
      },
      {
        projectId: commerceProj.id,
        key: 'checkout-cta-copy',
        name: 'Checkout Primary CTA Copy',
        description: 'Multivariate experiment testing checkout button messaging.',
        flagType: 'STRING',
        ownerId: editorUser.id,
        defaultVariationKey: 'control',
        offVariationKey: 'control',
        tags: ['experiment', 'growth'],
      },
      {
        projectId: commerceProj.id,
        key: 'max-cart-items',
        name: 'Maximum Cart Line Items',
        description: 'Dynamic upper bound on cart items per order to protect inventory lock latency.',
        flagType: 'NUMBER',
        ownerId: editorUser.id,
        defaultVariationKey: 'standard',
        offVariationKey: 'standard',
        tags: ['scalability', 'limits'],
      },
      {
        projectId: commerceProj.id,
        key: 'recommendation-weights',
        name: 'Product Ranking Weights Payload',
        description: 'JSON scoring weights for real-time merchandising ranker without redeployment.',
        flagType: 'JSON',
        ownerId: adminUser.id,
        defaultVariationKey: 'balanced',
        offVariationKey: 'balanced',
        tags: ['ml-config', 'search'],
      },
      {
        projectId: commerceProj.id,
        key: 'instant-refunds',
        name: 'Instant Wallet Refunds',
        description: 'Credits verified return requests immediately; guarded by emergency kill switch.',
        flagType: 'BOOLEAN',
        ownerId: approverUser.id,
        defaultVariationKey: 'off',
        offVariationKey: 'off',
        tags: ['payments', 'kill-switch'],
      },
      {
        projectId: commerceProj.id,
        key: 'legacy-promo-banner',
        name: 'Spring 2026 Shipping Banner',
        description: 'Free shipping header banner fully rolled out; candidate for cleanup.',
        flagType: 'BOOLEAN',
        ownerId: editorUser.id,
        defaultVariationKey: 'on',
        offVariationKey: 'off',
        tags: ['hygiene', 'marketing'],
      },
      {
        projectId: commerceProj.id,
        key: 'holiday-snow-theme',
        name: 'Seasonal Winter Storefront Overlay',
        description: 'Unused holiday animation flag retained from last season.',
        flagType: 'BOOLEAN',
        ownerId: viewerUser.id,
        defaultVariationKey: 'off',
        offVariationKey: 'off',
        tags: ['seasonal', 'cleanup'],
      },
      {
        projectId: bankingProj.id,
        key: 'biometric-wire-approval',
        name: 'Biometric Wire Transfer Approval',
        description: 'Requires FaceID/TouchID confirmation for wires exceeding $5,000.',
        flagType: 'BOOLEAN',
        ownerId: adminUser.id,
        defaultVariationKey: 'off',
        offVariationKey: 'off',
        tags: ['security', 'compliance'],
      },
    ])
    .returning();

  const [
    fNewCheckout,
    fCtaCopy,
    fMaxCart,
    fRecWeights,
    fInstantRefunds,
    fLegacyBanner,
    fHolidaySnow,
    fBiometric,
  ] = flagsSeed;

  // Variations for all 8 flags
  await db.insert(flagVariations).values([
    { flagId: fNewCheckout.id, variationKey: 'off', name: 'Legacy Checkout', valueJson: false, sortOrder: 0 },
    { flagId: fNewCheckout.id, variationKey: 'on', name: 'Express Checkout', valueJson: true, sortOrder: 1 },

    { flagId: fCtaCopy.id, variationKey: 'control', name: 'Place Order', valueJson: 'Place Order', sortOrder: 0 },
    { flagId: fCtaCopy.id, variationKey: 'instant', name: 'Complete Instant Order', valueJson: 'Complete Instant Order', sortOrder: 1 },
    { flagId: fCtaCopy.id, variationKey: 'secure', name: 'Pay Securely Now', valueJson: 'Pay Securely Now', sortOrder: 2 },

    { flagId: fMaxCart.id, variationKey: 'standard', name: 'Standard (25)', valueJson: 25, sortOrder: 0 },
    { flagId: fMaxCart.id, variationKey: 'high', name: 'Enterprise (100)', valueJson: 100, sortOrder: 1 },

    {
      flagId: fRecWeights.id,
      variationKey: 'balanced',
      name: 'Balanced v1',
      valueJson: { recency: 0.35, margin: 0.25, affinity: 0.4, maxItems: 12 },
      sortOrder: 0,
    },
    {
      flagId: fRecWeights.id,
      variationKey: 'affinity-heavy',
      name: 'Affinity Boost v2',
      valueJson: { recency: 0.2, margin: 0.15, affinity: 0.65, maxItems: 16 },
      sortOrder: 1,
    },

    { flagId: fInstantRefunds.id, variationKey: 'off', name: 'Disabled', valueJson: false, sortOrder: 0 },
    { flagId: fInstantRefunds.id, variationKey: 'on', name: 'Enabled', valueJson: true, sortOrder: 1 },

    { flagId: fLegacyBanner.id, variationKey: 'off', name: 'Hidden', valueJson: false, sortOrder: 0 },
    { flagId: fLegacyBanner.id, variationKey: 'on', name: 'Visible', valueJson: true, sortOrder: 1 },

    { flagId: fHolidaySnow.id, variationKey: 'off', name: 'Off', valueJson: false, sortOrder: 0 },
    { flagId: fHolidaySnow.id, variationKey: 'on', name: 'On', valueJson: true, sortOrder: 1 },

    { flagId: fBiometric.id, variationKey: 'off', name: 'OTP Fallback', valueJson: false, sortOrder: 0 },
    { flagId: fBiometric.id, variationKey: 'on', name: 'Biometric Enforced', valueJson: true, sortOrder: 1 },
  ]);

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  // Rollout configurations across environments
  await db.insert(rolloutConfigurations).values([
    // new-checkout
    {
      flagId: fNewCheckout.id,
      environmentId: commDev.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 100,
      individualTargets: { 'qa-alice': 'on' },
      version: 3,
      evaluationCount: 18420,
      lastEvaluatedAt: new Date(),
      fullRolloutSince: daysAgo(5),
    },
    {
      flagId: fNewCheckout.id,
      environmentId: commStage.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 50,
      individualTargets: { 'qa-alice': 'on' },
      version: 2,
      evaluationCount: 9410,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fNewCheckout.id,
      environmentId: commProd.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 20,
      individualTargets: { 'pm-aria': 'on', 'qa-alice': 'on' },
      version: 4,
      evaluationCount: 148290,
      lastEvaluatedAt: new Date(),
    },

    // checkout-cta-copy
    {
      flagId: fCtaCopy.id,
      environmentId: commDev.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'control',
      rolloutVariationKey: 'instant',
      rolloutPercentage: 50,
      rolloutWeights: [
        { variationKey: 'control', weight: 50 },
        { variationKey: 'instant', weight: 50 },
      ],
      version: 2,
      evaluationCount: 5120,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fCtaCopy.id,
      environmentId: commStage.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'control',
      rolloutVariationKey: 'instant',
      rolloutPercentage: 50,
      rolloutWeights: [
        { variationKey: 'control', weight: 50 },
        { variationKey: 'instant', weight: 50 },
      ],
      version: 1,
      evaluationCount: 3890,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fCtaCopy.id,
      environmentId: commProd.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'control',
      rolloutVariationKey: 'instant',
      rolloutPercentage: 50,
      rolloutWeights: [
        { variationKey: 'control', weight: 50 },
        { variationKey: 'instant', weight: 50 },
      ],
      version: 2,
      evaluationCount: 64110,
      lastEvaluatedAt: new Date(),
    },

    // max-cart-items
    {
      flagId: fMaxCart.id,
      environmentId: commDev.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'standard',
      rolloutVariationKey: 'high',
      rolloutPercentage: 100,
      version: 1,
      evaluationCount: 2410,
      lastEvaluatedAt: new Date(),
      fullRolloutSince: daysAgo(4),
    },
    {
      flagId: fMaxCart.id,
      environmentId: commStage.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'standard',
      rolloutVariationKey: 'high',
      rolloutPercentage: 25,
      version: 1,
      evaluationCount: 1920,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fMaxCart.id,
      environmentId: commProd.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'standard',
      rolloutVariationKey: 'high',
      rolloutPercentage: 10,
      version: 2,
      evaluationCount: 41050,
      lastEvaluatedAt: new Date(),
    },

    // recommendation-weights
    {
      flagId: fRecWeights.id,
      environmentId: commDev.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'balanced',
      rolloutVariationKey: 'affinity-heavy',
      rolloutPercentage: 75,
      version: 2,
      evaluationCount: 6200,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fRecWeights.id,
      environmentId: commStage.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'balanced',
      rolloutVariationKey: 'affinity-heavy',
      rolloutPercentage: 50,
      version: 1,
      evaluationCount: 4120,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fRecWeights.id,
      environmentId: commProd.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'balanced',
      rolloutVariationKey: 'affinity-heavy',
      rolloutPercentage: 15,
      version: 1,
      evaluationCount: 31200,
      lastEvaluatedAt: new Date(),
    },

    // instant-refunds
    {
      flagId: fInstantRefunds.id,
      environmentId: commDev.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 100,
      version: 1,
      evaluationCount: 1200,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fInstantRefunds.id,
      environmentId: commStage.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 50,
      version: 1,
      evaluationCount: 840,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fInstantRefunds.id,
      environmentId: commProd.id,
      enabled: false,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 5,
      version: 1,
      evaluationCount: 14200,
      lastEvaluatedAt: new Date(),
    },

    // legacy-promo-banner (STALE: 100% rolled out for 24 days!)
    {
      flagId: fLegacyBanner.id,
      environmentId: commDev.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'on',
      rolloutVariationKey: 'on',
      rolloutPercentage: 100,
      version: 3,
      evaluationCount: 9100,
      lastEvaluatedAt: new Date(),
      fullRolloutSince: daysAgo(24),
    },
    {
      flagId: fLegacyBanner.id,
      environmentId: commStage.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'on',
      rolloutVariationKey: 'on',
      rolloutPercentage: 100,
      version: 2,
      evaluationCount: 12000,
      lastEvaluatedAt: new Date(),
      fullRolloutSince: daysAgo(24),
    },
    {
      flagId: fLegacyBanner.id,
      environmentId: commProd.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'on',
      rolloutVariationKey: 'on',
      rolloutPercentage: 100,
      version: 5,
      evaluationCount: 285400,
      lastEvaluatedAt: new Date(),
      fullRolloutSince: daysAgo(24),
    },

    // holiday-snow-theme (STALE: unused for 46 days!)
    {
      flagId: fHolidaySnow.id,
      environmentId: commDev.id,
      enabled: false,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 0,
      version: 1,
      evaluationCount: 320,
      lastEvaluatedAt: daysAgo(46),
    },
    {
      flagId: fHolidaySnow.id,
      environmentId: commStage.id,
      enabled: false,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 0,
      version: 1,
      evaluationCount: 190,
      lastEvaluatedAt: daysAgo(46),
    },
    {
      flagId: fHolidaySnow.id,
      environmentId: commProd.id,
      enabled: false,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 0,
      version: 1,
      evaluationCount: 4100,
      lastEvaluatedAt: daysAgo(46),
    },

    // biometric-wire-approval (Banking project)
    {
      flagId: fBiometric.id,
      environmentId: bankDev.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 100,
      version: 2,
      evaluationCount: 4200,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fBiometric.id,
      environmentId: bankStage.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 50,
      version: 1,
      evaluationCount: 2100,
      lastEvaluatedAt: new Date(),
    },
    {
      flagId: fBiometric.id,
      environmentId: bankProd.id,
      enabled: true,
      killSwitch: false,
      defaultVariationKey: 'off',
      rolloutVariationKey: 'on',
      rolloutPercentage: 10,
      version: 1,
      evaluationCount: 38200,
      lastEvaluatedAt: new Date(),
    },
  ]);

  // 6. Seed Targeting Rules
  await db.insert(targetingRules).values([
    {
      flagId: fNewCheckout.id,
      environmentId: commProd.id,
      name: 'Enable for Internal & Beta Cohort',
      priority: 1,
      segmentKey: 'beta-testers',
      ruleGroup: { type: 'group', combinator: 'AND', children: [] },
      serveVariationKey: 'on',
      enabled: true,
    },
    {
      flagId: fNewCheckout.id,
      environmentId: commProd.id,
      name: 'US Enterprise Web v2.2+',
      priority: 2,
      segmentKey: null,
      ruleGroup: {
        type: 'group',
        combinator: 'AND',
        children: [
          { type: 'condition', attribute: 'country', operator: 'EQUALS', value: 'US' },
          { type: 'condition', attribute: 'appVersion', operator: 'SEMVER_GT', value: '2.2.0' },
        ],
      },
      serveVariationKey: 'on',
      enabled: true,
    },
    {
      flagId: fMaxCart.id,
      environmentId: commProd.id,
      name: 'Enterprise Accounts 100-Item Limit',
      priority: 1,
      segmentKey: 'enterprise-tier',
      ruleGroup: { type: 'group', combinator: 'AND', children: [] },
      serveVariationKey: 'high',
      enabled: true,
    },
  ]);

  // 7. Seed Flag Versions
  await db.insert(flagVersions).values([
    {
      flagId: fNewCheckout.id,
      environmentId: commProd.id,
      versionNumber: 1,
      authorId: adminUser.id,
      changeReason: 'Initial production flag creation at 0% rollout',
      snapshotJson: { enabled: false, killSwitch: false, rolloutPercentage: 0, defaultVariationKey: 'off' },
      diffJson: { rolloutPercentage: { before: null, after: 0 } },
      createdAt: daysAgo(12),
    },
    {
      flagId: fNewCheckout.id,
      environmentId: commProd.id,
      versionNumber: 2,
      authorId: editorUser.id,
      changeReason: 'Enable canary 5% rollout after staging soak test',
      snapshotJson: { enabled: true, killSwitch: false, rolloutPercentage: 5, defaultVariationKey: 'off' },
      diffJson: { enabled: { before: false, after: true }, rolloutPercentage: { before: 0, after: 5 } },
      createdAt: daysAgo(7),
    },
    {
      flagId: fNewCheckout.id,
      environmentId: commProd.id,
      versionNumber: 3,
      authorId: approverUser.id,
      changeReason: 'Expand rollout to 10% following zero payment regressions',
      snapshotJson: { enabled: true, killSwitch: false, rolloutPercentage: 10, defaultVariationKey: 'off' },
      diffJson: { rolloutPercentage: { before: 5, after: 10 } },
      createdAt: daysAgo(4),
    },
    {
      flagId: fNewCheckout.id,
      environmentId: commProd.id,
      versionNumber: 4,
      authorId: adminUser.id,
      changeReason: 'Increase production rollout from 10% to 20% (preserving original 10% cohort)',
      snapshotJson: { enabled: true, killSwitch: false, rolloutPercentage: 20, defaultVariationKey: 'off' },
      diffJson: { rolloutPercentage: { before: 10, after: 20 } },
      createdAt: daysAgo(1),
    },
  ]);

  // 8. Seed Pending Production Approval Requests (2-person approval workflow)
  await db.insert(approvals).values([
    {
      projectId: commerceProj.id,
      flagId: fNewCheckout.id,
      environmentId: commProd.id,
      requesterId: editorUser.id,
      status: 'PENDING',
      requiredApprovals: 2,
      approvers: [
        {
          userId: approverUser.id,
          userName: approverUser.fullName,
          decision: 'APPROVED',
          comment: 'Latency p99 and payment success rate verified across 20% cohort.',
          decidedAt: new Date(Date.now() - 3600 * 1000 * 3).toISOString(),
        },
      ],
      reason: 'Expand One-Click Express Checkout from 20% to 50% in Production following +28% conversion lift.',
      currentSnapshot: { enabled: true, killSwitch: false, rolloutPercentage: 20 },
      proposedChanges: { enabled: true, killSwitch: false, rolloutPercentage: 50 },
      createdAt: new Date(Date.now() - 3600 * 1000 * 4),
    },
    {
      projectId: commerceProj.id,
      flagId: fInstantRefunds.id,
      environmentId: commProd.id,
      requesterId: editorUser.id,
      status: 'PENDING',
      requiredApprovals: 2,
      approvers: [],
      reason: 'Enable Instant Wallet Refunds for 10% of verified accounts in Production.',
      currentSnapshot: { enabled: false, killSwitch: false, rolloutPercentage: 5 },
      proposedChanges: { enabled: true, killSwitch: false, rolloutPercentage: 10 },
      scheduledFor: new Date(Date.now() + 24 * 3600 * 1000),
      createdAt: new Date(Date.now() - 3600 * 1000 * 1),
    },
  ]);

  // 9. Seed Experiments + Exposure & Goal Events
  const insertedExps = await db
    .insert(experiments)
    .values([
      {
        projectId: commerceProj.id,
        flagId: fNewCheckout.id,
        environmentId: commProd.id,
        name: 'Express Checkout Conversion Lift',
        hypothesis: 'Reducing checkout from 3 steps to 1 tokenized click increases order completion by at least 15%.',
        primaryMetric: 'order_completed',
        status: 'RUNNING',
        trafficAllocation: 100,
        createdById: adminUser.id,
        startedAt: daysAgo(6),
      },
      {
        projectId: commerceProj.id,
        flagId: fCtaCopy.id,
        environmentId: commProd.id,
        name: 'Checkout CTA Urgency Copy Test',
        hypothesis: 'Action-oriented CTA copy reduces cart abandonment on mobile Safari.',
        primaryMetric: 'checkout_clicked',
        status: 'RUNNING',
        trafficAllocation: 100,
        createdById: editorUser.id,
        startedAt: daysAgo(3),
      },
    ])
    .returning();

  const [expCheckout, expCta] = insertedExps;

  await db.insert(experimentVariations).values([
    { experimentId: expCheckout.id, variationKey: 'off', name: 'Legacy Checkout (Control)', isControl: true, expectedWeight: 50 },
    { experimentId: expCheckout.id, variationKey: 'on', name: 'Express Checkout (Treatment)', isControl: false, expectedWeight: 50 },
    { experimentId: expCta.id, variationKey: 'control', name: 'Place Order (Control)', isControl: true, expectedWeight: 50 },
    { experimentId: expCta.id, variationKey: 'instant', name: 'Complete Instant Order', isControl: false, expectedWeight: 50 },
  ]);

  // Seed realistic exposure & goal events directly in PostgreSQL
  const exp1Exposures: Array<typeof exposureEvents.$inferInsert> = [];
  const exp1Goals: Array<typeof goalEvents.$inferInsert> = [];
  // Control: 420 exposures, 46 conversions (10.95%)
  for (let i = 0; i < 420; i++) {
    exp1Exposures.push({
      experimentId: expCheckout.id,
      flagKey: 'new-checkout',
      userKey: `shopper-c-${i}`,
      variationKey: 'off',
      createdAt: daysAgo(i % 6),
    });
    if (i < 46) {
      exp1Goals.push({
        experimentId: expCheckout.id,
        metricName: 'order_completed',
        userKey: `shopper-c-${i}`,
        variationKey: 'off',
        value: 1,
        createdAt: daysAgo(i % 6),
      });
    }
  }
  // Treatment: 432 exposures, 71 conversions (16.44% -> statistically significant p < 0.02!)
  for (let i = 0; i < 432; i++) {
    exp1Exposures.push({
      experimentId: expCheckout.id,
      flagKey: 'new-checkout',
      userKey: `shopper-t-${i}`,
      variationKey: 'on',
      createdAt: daysAgo(i % 6),
    });
    if (i < 71) {
      exp1Goals.push({
        experimentId: expCheckout.id,
        metricName: 'order_completed',
        userKey: `shopper-t-${i}`,
        variationKey: 'on',
        value: 1,
        createdAt: daysAgo(i % 6),
      });
    }
  }

  // Exp 2: Deliberate subtle split (Control 210 / 26 conv, Variant 204 / 31 conv)
  for (let i = 0; i < 210; i++) {
    exp1Exposures.push({
      experimentId: expCta.id,
      flagKey: 'checkout-cta-copy',
      userKey: `cta-c-${i}`,
      variationKey: 'control',
      createdAt: daysAgo(i % 3),
    });
    if (i < 26) {
      exp1Goals.push({
        experimentId: expCta.id,
        metricName: 'checkout_clicked',
        userKey: `cta-c-${i}`,
        variationKey: 'control',
        value: 1,
        createdAt: daysAgo(i % 3),
      });
    }
  }
  for (let i = 0; i < 204; i++) {
    exp1Exposures.push({
      experimentId: expCta.id,
      flagKey: 'checkout-cta-copy',
      userKey: `cta-v-${i}`,
      variationKey: 'instant',
      createdAt: daysAgo(i % 3),
    });
    if (i < 31) {
      exp1Goals.push({
        experimentId: expCta.id,
        metricName: 'checkout_clicked',
        userKey: `cta-v-${i}`,
        variationKey: 'instant',
        value: 1,
        createdAt: daysAgo(i % 3),
      });
    }
  }

  await db.insert(exposureEvents).values(exp1Exposures);
  await db.insert(goalEvents).values(exp1Goals);

  // 10. Seed Audit Logs
  await db.insert(auditLogs).values([
    {
      projectId: commerceProj.id,
      environmentId: commProd.id,
      actorId: adminUser.id,
      actorName: adminUser.fullName,
      action: 'ROLLOUT_UPDATED',
      entityType: 'FEATURE_FLAG',
      entityId: fNewCheckout.key,
      summary: 'Updated rollout percentage from 10% to 20% in Production',
      beforeState: { rolloutPercentage: 10 },
      afterState: { rolloutPercentage: 20 },
      traceId: crypto.randomUUID(),
      createdAt: daysAgo(1),
    },
    {
      projectId: commerceProj.id,
      environmentId: commProd.id,
      actorId: editorUser.id,
      actorName: editorUser.fullName,
      action: 'APPROVAL_REQUESTED',
      entityType: 'APPROVAL',
      entityId: fNewCheckout.key,
      summary: 'Requested 2-person approval to expand new-checkout rollout to 50%',
      beforeState: { rolloutPercentage: 20 },
      afterState: { rolloutPercentage: 50 },
      traceId: crypto.randomUUID(),
      createdAt: new Date(Date.now() - 3600 * 1000 * 4),
    },
    {
      projectId: commerceProj.id,
      environmentId: commProd.id,
      actorId: approverUser.id,
      actorName: approverUser.fullName,
      action: 'APPROVAL_ENDORSED',
      entityType: 'APPROVAL',
      entityId: fNewCheckout.key,
      summary: 'Recorded 1 of 2 required approvals for new-checkout 50% rollout',
      beforeState: { approvals: 0 },
      afterState: { approvals: 1 },
      traceId: crypto.randomUUID(),
      createdAt: new Date(Date.now() - 3600 * 1000 * 3),
    },
    {
      projectId: commerceProj.id,
      environmentId: commStage.id,
      actorId: editorUser.id,
      actorName: editorUser.fullName,
      action: 'SEGMENT_CREATED',
      entityType: 'SEGMENT',
      entityId: 'enterprise-tier',
      summary: 'Created reusable segment Enterprise High-Value Customers',
      beforeState: null,
      afterState: { key: 'enterprise-tier' },
      traceId: crypto.randomUUID(),
      createdAt: daysAgo(2),
    },
    {
      projectId: bankingProj.id,
      environmentId: bankProd.id,
      actorId: adminUser.id,
      actorName: adminUser.fullName,
      action: 'FLAG_CREATED',
      entityType: 'FEATURE_FLAG',
      entityId: fBiometric.key,
      summary: 'Created feature flag biometric-wire-approval in Mobile Banking Suite',
      beforeState: null,
      afterState: { key: fBiometric.key, flagType: 'BOOLEAN' },
      traceId: crypto.randomUUID(),
      createdAt: daysAgo(3),
    },
  ]);

  // Ensure exact row count sanity (touching eq import cleanly)
  await db.select().from(projects).where(eq(projects.key, 'commerce-core')).limit(1);
}
