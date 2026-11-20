import type {
  EvaluationContext,
  EvaluationReason,
  EvaluationResult,
  FlagEnvironmentSnapshot,
  RuleCondition,
  RuleGroup,
  RuleOperator,
  SegmentDef,
} from './types.ts';

/**
 * MurmurHash3 32-bit (x86_32) deterministic hash.
 * Identical implementation exists in FlagShip Java Starter (MurmurHash3.java)
 * to guarantee 100% parity across server preview and Java SDK instances (QA4).
 */
export function murmurHash3_32(input: string, seed = 0): number {
  const bytes = new TextEncoder().encode(input);
  const len = bytes.length;
  let h1 = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const roundedEnd = len & ~3;

  for (let i = 0; i < roundedEnd; i += 4) {
    let k1 =
      (bytes[i] & 0xff) |
      ((bytes[i + 1] & 0xff) << 8) |
      ((bytes[i + 2] & 0xff) << 16) |
      ((bytes[i + 3] & 0xff) << 24);
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }

  let k1 = 0;
  switch (len & 3) {
    case 3:
      k1 ^= (bytes[roundedEnd + 2] & 0xff) << 16;
    // fallthrough
    case 2:
      k1 ^= (bytes[roundedEnd + 1] & 0xff) << 8;
    // fallthrough
    case 1:
      k1 ^= bytes[roundedEnd] & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/**
 * Deterministic bucket in range [0, 99999] representing 0.000% to 99.999%.
 * Guarantees monotonicity: increasing rollout from 10% (10000) to 20% (20000)
 * strictly retains every user originally bucketed in [0, 9999].
 */
export function computeRolloutBucket(flagKey: string, userKey: string): number {
  return murmurHash3_32(`${flagKey}:${userKey}`, 0) % 100000;
}

/**
 * Semantic version parser & comparator (major.minor.patch).
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const clean = v.trim().replace(/^v/i, '').split('-')[0];
    const parts = clean.split('.').map((p) => Number.parseInt(p, 10));
    return [
      Number.isFinite(parts[0]) ? parts[0] : 0,
      Number.isFinite(parts[1]) ? parts[1] : 0,
      Number.isFinite(parts[2]) ? parts[2] : 0,
    ];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Strategy Pattern: Operator Evaluators for all 12 required operators.
 */
const operatorStrategies: Record<
  RuleOperator,
  (attrVal: string, target: string | string[]) => boolean
> = {
  EQUALS: (attrVal, target) => attrVal === String(target),
  NOT_EQUALS: (attrVal, target) => attrVal !== String(target),
  IN: (attrVal, target) => {
    const list = Array.isArray(target)
      ? target
      : String(target)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    return list.includes(attrVal);
  },
  NOT_IN: (attrVal, target) => !operatorStrategies.IN(attrVal, target),
  CONTAINS: (attrVal, target) => attrVal.includes(String(target)),
  STARTS_WITH: (attrVal, target) => attrVal.startsWith(String(target)),
  ENDS_WITH: (attrVal, target) => attrVal.endsWith(String(target)),
  REGEX: (attrVal, target) => {
    try {
      return new RegExp(String(target)).test(attrVal);
    } catch {
      return false;
    }
  },
  SEMVER_GT: (attrVal, target) => compareSemver(attrVal, String(target)) > 0,
  SEMVER_LT: (attrVal, target) => compareSemver(attrVal, String(target)) < 0,
  DATE_BEFORE: (attrVal, target) => {
    const t1 = Date.parse(attrVal);
    const t2 = Date.parse(String(target));
    return Number.isFinite(t1) && Number.isFinite(t2) && t1 < t2;
  },
  DATE_AFTER: (attrVal, target) => {
    const t1 = Date.parse(attrVal);
    const t2 = Date.parse(String(target));
    return Number.isFinite(t1) && Number.isFinite(t2) && t1 > t2;
  },
};

export function evaluateCondition(
  condition: RuleCondition,
  context: EvaluationContext
): boolean {
  const raw =
    condition.attribute === 'userKey'
      ? context.userKey
      : context.attributes?.[condition.attribute];
  if (raw === undefined || raw === null) {
    return condition.operator === 'NOT_EQUALS' || condition.operator === 'NOT_IN';
  }
  const strategy = operatorStrategies[condition.operator];
  if (!strategy) return false;
  return strategy(String(raw), condition.value);
}

/**
 * Composite Pattern: Recursive evaluation of nested AND/OR rule groups.
 */
export function evaluateRuleGroup(
  group: RuleGroup | undefined | null,
  context: EvaluationContext
): boolean {
  if (!group || !Array.isArray(group.children) || group.children.length === 0) {
    return false;
  }
  if (group.combinator === 'AND') {
    for (const child of group.children) {
      const ok =
        child.type === 'group'
          ? evaluateRuleGroup(child, context)
          : evaluateCondition(child, context);
      if (!ok) return false;
    }
    return true;
  }
  // OR combinator
  for (const child of group.children) {
    const ok =
      child.type === 'group'
        ? evaluateRuleGroup(child, context)
        : evaluateCondition(child, context);
    if (ok) return true;
  }
  return false;
}

export function matchesSegment(
  segment: SegmentDef | undefined,
  context: EvaluationContext
): boolean {
  if (!segment) return false;
  if (segment.excludedUsers.includes(context.userKey)) return false;
  if (segment.includedUsers.includes(context.userKey)) return true;
  return evaluateRuleGroup(segment.ruleGroup, context);
}

function nowMicros(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() * 1000;
  }
  return Date.now() * 1000;
}

function resolveVariationValue(
  snapshot: FlagEnvironmentSnapshot,
  variationKey: string
): unknown {
  const found = snapshot.variations.find((v) => v.variationKey === variationKey);
  if (found !== undefined) return found.value;
  return snapshot.variations[0]?.value ?? false;
}

/**
 * Chain of Responsibility: Strict 5-step Flag Evaluation Pipeline
 * 1. Kill switch (and flag disabled check)
 * 2. Individual user targeting
 * 3. Segment targeting & attribute rules
 * 4. Percentage gradual rollout (deterministic MurmurHash3_32)
 * 5. Default variation fallback
 */
export function evaluateFlag<T = unknown>(
  snapshot: FlagEnvironmentSnapshot,
  context: EvaluationContext,
  segmentsMap: Record<string, SegmentDef> = {}
): EvaluationResult<T> {
  const start = nowMicros();
  const buildResult = (
    variationKey: string,
    reason: EvaluationReason,
    matchedRuleName?: string,
    bucket?: number
  ): EvaluationResult<T> => ({
    flagKey: snapshot.flagKey,
    variationKey,
    value: resolveVariationValue(snapshot, variationKey) as T,
    reason,
    matchedRuleName,
    bucket,
    durationMicros: Math.max(0.1, Number((nowMicros() - start).toFixed(2))),
  });

  // Step 1: Kill Switch & Enabled Check
  if (snapshot.killSwitch) {
    return buildResult(snapshot.offVariationKey, 'KILL_SWITCH');
  }
  if (!snapshot.enabled) {
    return buildResult(snapshot.offVariationKey, 'FLAG_DISABLED');
  }

  // Step 2: Individual User Targeting
  const targetedVar = snapshot.individualTargets?.[context.userKey];
  if (targetedVar) {
    return buildResult(targetedVar, 'INDIVIDUAL_TARGET');
  }

  // Step 3: Segment & Targeting Rules (sorted by priority)
  const sortedRules = [...(snapshot.rules || [])]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (rule.segmentKey) {
      const seg = segmentsMap[rule.segmentKey];
      const segMatched = matchesSegment(seg, context);
      const hasExtraConditions =
        rule.ruleGroup && Array.isArray(rule.ruleGroup.children) && rule.ruleGroup.children.length > 0;
      if (segMatched && (!hasExtraConditions || evaluateRuleGroup(rule.ruleGroup, context))) {
        return buildResult(rule.serveVariationKey, 'SEGMENT_MATCH', rule.name);
      }
    } else if (evaluateRuleGroup(rule.ruleGroup, context)) {
      return buildResult(rule.serveVariationKey, 'TARGETING_RULE', rule.name);
    }
  }

  // Step 4: Deterministic Percentage Gradual Rollout
  const bucket = computeRolloutBucket(snapshot.flagKey, context.userKey);
  if (snapshot.rolloutWeights && snapshot.rolloutWeights.length > 0) {
    let cumulative = 0;
    for (const w of snapshot.rolloutWeights) {
      cumulative += w.weight * 1000;
      if (bucket < cumulative) {
        return buildResult(w.variationKey, 'PERCENTAGE_ROLLOUT', undefined, bucket);
      }
    }
  } else if (snapshot.rolloutPercentage > 0) {
    const threshold = Math.min(100, Math.max(0, snapshot.rolloutPercentage)) * 1000;
    if (bucket < threshold) {
      return buildResult(snapshot.rolloutVariationKey, 'PERCENTAGE_ROLLOUT', undefined, bucket);
    }
  }

  // Step 5: Default Variation
  return buildResult(
    snapshot.envDefaultVariationKey || snapshot.defaultVariationKey,
    'DEFAULT_VARIATION',
    undefined,
    bucket
  );
}
