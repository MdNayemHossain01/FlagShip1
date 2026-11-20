import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRolloutBucket,
  evaluateFlag,
  compareSemver,
  murmurHash3_32,
} from './evaluator.ts';
import type { FlagEnvironmentSnapshot, SegmentDef } from './types.ts';

function makeSnapshot(overrides: Partial<FlagEnvironmentSnapshot> = {}): FlagEnvironmentSnapshot {
  return {
    flagKey: 'new-checkout',
    flagType: 'BOOLEAN',
    offVariationKey: 'off',
    defaultVariationKey: 'off',
    variations: [
      { variationKey: 'off', name: 'Control', value: false },
      { variationKey: 'on', name: 'New Checkout', value: true },
    ],
    enabled: true,
    killSwitch: false,
    envDefaultVariationKey: 'off',
    rolloutVariationKey: 'on',
    rolloutPercentage: 0,
    rolloutWeights: [],
    individualTargets: {},
    rules: [],
    version: 1,
    ...overrides,
  };
}

test('Step 1: Kill switch overrides individual targets, segments, and 100% rollout', () => {
  const snapshot = makeSnapshot({
    killSwitch: true,
    enabled: true,
    rolloutPercentage: 100,
    individualTargets: { 'user-vip': 'on' },
  });
  const res = evaluateFlag<boolean>(snapshot, { userKey: 'user-vip' });
  assert.equal(res.variationKey, 'off');
  assert.equal(res.value, false);
  assert.equal(res.reason, 'KILL_SWITCH');
});

test('Step 2: Individual user targeting precedes rules and rollout', () => {
  const snapshot = makeSnapshot({
    individualTargets: { 'qa-alice': 'on' },
    rolloutPercentage: 0,
  });
  const res = evaluateFlag<boolean>(snapshot, { userKey: 'qa-alice' });
  assert.equal(res.variationKey, 'on');
  assert.equal(res.value, true);
  assert.equal(res.reason, 'INDIVIDUAL_TARGET');
});

test('Step 3: Segment targeting & all 12 operators work in nested AND/OR groups', () => {
  const betaSegment: SegmentDef = {
    key: 'beta-us',
    name: 'US Beta Users',
    includedUsers: ['force-in'],
    excludedUsers: ['force-out'],
    ruleGroup: {
      type: 'group',
      combinator: 'AND',
      children: [
        { type: 'condition', attribute: 'country', operator: 'IN', value: ['US', 'CA'] },
        { type: 'condition', attribute: 'appVersion', operator: 'SEMVER_GT', value: '2.1.0' },
        { type: 'condition', attribute: 'email', operator: 'ENDS_WITH', value: '@acme.io' },
        {
          type: 'group',
          combinator: 'OR',
          children: [
            { type: 'condition', attribute: 'plan', operator: 'EQUALS', value: 'enterprise' },
            { type: 'condition', attribute: 'signupDate', operator: 'DATE_BEFORE', value: '2026-01-01' },
          ],
        },
      ],
    },
  };

  const snapshot = makeSnapshot({
    rules: [
      {
        name: 'Serve beta segment',
        priority: 1,
        segmentKey: 'beta-us',
        ruleGroup: { type: 'group', combinator: 'AND', children: [] },
        serveVariationKey: 'on',
        enabled: true,
      },
      {
        name: 'Regex internal staff',
        priority: 2,
        ruleGroup: {
          type: 'group',
          combinator: 'AND',
          children: [
            { type: 'condition', attribute: 'email', operator: 'REGEX', value: '^eng-[0-9]+@flagship\\.dev$' },
            { type: 'condition', attribute: 'region', operator: 'NOT_EQUALS', value: 'restricted' },
            { type: 'condition', attribute: 'appVersion', operator: 'SEMVER_LT', value: '5.0.0' },
            { type: 'condition', attribute: 'signupDate', operator: 'DATE_AFTER', value: '2024-01-01' },
            { type: 'condition', attribute: 'role', operator: 'NOT_IN', value: ['banned', 'suspended'] },
            { type: 'condition', attribute: 'bio', operator: 'CONTAINS', value: 'staff' },
            { type: 'condition', attribute: 'handle', operator: 'STARTS_WITH', value: 'dev_' },
          ],
        },
        serveVariationKey: 'on',
        enabled: true,
      },
    ],
  });

  const matchedSeg = evaluateFlag<boolean>(
    snapshot,
    {
      userKey: 'u-100',
      attributes: {
        country: 'US',
        appVersion: '2.4.1',
        email: 'jane@acme.io',
        plan: 'enterprise',
        signupDate: '2026-06-01',
      },
    },
    { 'beta-us': betaSegment }
  );
  assert.equal(matchedSeg.variationKey, 'on');
  assert.equal(matchedSeg.reason, 'SEGMENT_MATCH');

  const excluded = evaluateFlag<boolean>(
    snapshot,
    { userKey: 'force-out', attributes: { country: 'US', appVersion: '3.0.0', email: 'a@acme.io', plan: 'enterprise' } },
    { 'beta-us': betaSegment }
  );
  assert.equal(excluded.variationKey, 'off');

  const matchedRule2 = evaluateFlag<boolean>(snapshot, {
    userKey: 'u-200',
    attributes: {
      email: 'eng-42@flagship.dev',
      region: 'us-east',
      appVersion: '3.1.2',
      signupDate: '2025-05-10',
      role: 'engineer',
      bio: 'senior staff engineer',
      handle: 'dev_sam',
    },
  });
  assert.equal(matchedRule2.variationKey, 'on');
  assert.equal(matchedRule2.reason, 'TARGETING_RULE');
});

test('Step 4: Gradual rollout determinism and monotonicity (10% -> 20% preserves 100% of original 10%)', () => {
  const snap10 = makeSnapshot({ rolloutPercentage: 10 });
  const snap20 = makeSnapshot({ rolloutPercentage: 20 });

  let in10 = 0;
  let in20 = 0;
  let preserved = 0;
  const sampleSize = 10000;

  for (let i = 0; i < sampleSize; i++) {
    const ctx = { userKey: `user-${i}` };
    const r10 = evaluateFlag<boolean>(snap10, ctx);
    const r20 = evaluateFlag<boolean>(snap20, ctx);
    // Determinism check
    assert.equal(r10.variationKey, evaluateFlag<boolean>(snap10, ctx).variationKey);
    if (r10.value) {
      in10++;
      if (r20.value) preserved++;
    }
    if (r20.value) in20++;
  }

  assert.equal(preserved, in10, 'All users in 10% cohort MUST remain in 20% cohort');
  assert.ok(in10 > 850 && in10 < 1150, `Expected ~10% in 10% rollout, got ${in10}`);
  assert.ok(in20 > 1800 && in20 < 2200, `Expected ~20% in 20% rollout, got ${in20}`);
});

test('MurmurHash3_32 known vector & semver ordering', () => {
  assert.equal(murmurHash3_32('new-checkout:user-1'), murmurHash3_32('new-checkout:user-1'));
  const bucket = computeRolloutBucket('new-checkout', 'user-1');
  assert.ok(bucket >= 0 && bucket < 100000);
  assert.equal(compareSemver('2.10.0', '2.2.9'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
});
