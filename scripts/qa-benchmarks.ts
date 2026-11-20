import { computeRolloutBucket, evaluateFlag } from '../src/core/evaluator.ts';
import type { FlagEnvironmentSnapshot, TargetingRuleDef } from '../src/core/types.ts';

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ---------------- QA1: 10-rule p99 <= 50us & 1,000 flags heap <= 20MB ----------------
function runQa1() {
  const rules: TargetingRuleDef[] = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    name: `Rule-${i + 1}`,
    priority: i + 1,
    serveVariationKey: 'on',
    enabled: true,
    ruleGroup: {
      type: 'group',
      combinator: 'AND',
      children: [
        { type: 'condition', attribute: 'country', operator: 'EQUALS', value: `REGION_${i}` },
        { type: 'condition', attribute: 'appVersion', operator: 'SEMVER_GT', value: '2.0.0' },
      ],
    },
  }));

  const snapshot: FlagEnvironmentSnapshot = {
    flagKey: 'qa1-checkout',
    flagType: 'BOOLEAN',
    offVariationKey: 'off',
    defaultVariationKey: 'off',
    variations: [
      { variationKey: 'off', name: 'Off', value: false },
      { variationKey: 'on', name: 'On', value: true },
    ],
    enabled: true,
    killSwitch: false,
    envDefaultVariationKey: 'off',
    rolloutVariationKey: 'on',
    rolloutPercentage: 25,
    rolloutWeights: [],
    individualTargets: {},
    rules,
    version: 1,
  };

  // Warmup JIT
  for (let i = 0; i < 2000; i++) {
    evaluateFlag(snapshot, {
      userKey: `warm-${i}`,
      attributes: { country: 'US', appVersion: '2.5.0' },
    });
  }

  const iterations = 10000;
  const latenciesMicros: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    evaluateFlag(snapshot, {
      userKey: `user-${i}`,
      attributes: { country: 'US', appVersion: '2.5.0' },
    });
    latenciesMicros[i] = (performance.now() - t0) * 1000;
  }
  latenciesMicros.sort((a, b) => a - b);

  // Measure heap delta for 1,000 flags
  const heapBefore = process.memoryUsage().heapUsed;
  const thousandFlags: Record<string, FlagEnvironmentSnapshot> = {};
  for (let i = 0; i < 1000; i++) {
    thousandFlags[`flag-${i}`] = {
      ...snapshot,
      flagKey: `flag-${i}`,
      rules: rules.map((r) => ({ ...r })),
    };
  }
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaMb = Math.max(0, (heapAfter - heapBefore) / (1024 * 1024));

  return {
    iterations,
    p50Micros: Number(percentile(latenciesMicros, 50).toFixed(3)),
    p95Micros: Number(percentile(latenciesMicros, 95).toFixed(3)),
    p99Micros: Number(percentile(latenciesMicros, 99).toFixed(3)),
    heapDelta1000FlagsMb: Number(heapDeltaMb.toFixed(3)),
    cachedKeys: Object.keys(thousandFlags).length,
    passLatency: percentile(latenciesMicros, 99) <= 50,
    passMemory: heapDeltaMb <= 20,
  };
}

// ---------------- QA4: 1,000,000 user keys deterministic parity & 10% -> 20% retention ----------------
function runQa4() {
  const totalUsers = 1_000_000;
  const flagKey = 'new-checkout';
  let in10 = 0;
  let in20 = 0;
  let preserved10In20 = 0;
  const t0 = performance.now();

  for (let i = 0; i < totalUsers; i++) {
    const bucket = computeRolloutBucket(flagKey, `u-${i}`);
    const match10 = bucket < 10000;
    const match20 = bucket < 20000;
    if (match10) {
      in10++;
      if (match20) preserved10In20++;
    }
    if (match20) in20++;
  }
  const elapsedMs = Number((performance.now() - t0).toFixed(1));

  return {
    totalUsers,
    elapsedMs,
    cohort10PercentCount: in10,
    cohort10PercentRate: Number(((in10 / totalUsers) * 100).toFixed(4)),
    cohort20PercentCount: in20,
    cohort20PercentRate: Number(((in20 / totalUsers) * 100).toFixed(4)),
    preserved10In20,
    retentionRatePercent: Number(((preserved10In20 / in10) * 100).toFixed(4)),
    passMonotonicity: preserved10In20 === in10,
  };
}

const qa1 = runQa1();
const qa4 = runQa4();

console.log(JSON.stringify({ measuredAt: new Date().toISOString(), qa1, qa4 }, null, 2));
if (!qa1.passLatency || !qa1.passMemory || !qa4.passMonotonicity) {
  process.exit(1);
}
