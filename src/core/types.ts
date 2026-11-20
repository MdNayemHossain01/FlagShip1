export type UserRole = 'ADMIN' | 'EDITOR' | 'APPROVER' | 'VIEWER';
export type FlagType = 'BOOLEAN' | 'STRING' | 'NUMBER' | 'JSON';

export type RuleOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'IN'
  | 'NOT_IN'
  | 'CONTAINS'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'REGEX'
  | 'SEMVER_GT'
  | 'SEMVER_LT'
  | 'DATE_BEFORE'
  | 'DATE_AFTER';

export interface RuleCondition {
  type: 'condition';
  attribute: string;
  operator: RuleOperator;
  value: string | string[];
}

export interface RuleGroup {
  type: 'group';
  combinator: 'AND' | 'OR';
  children: Array<RuleCondition | RuleGroup>;
}

export interface FlagVariationDef {
  variationKey: string;
  name: string;
  value: unknown;
  description?: string;
}

export interface SegmentDef {
  key: string;
  name: string;
  includedUsers: string[];
  excludedUsers: string[];
  ruleGroup: RuleGroup;
}

export interface TargetingRuleDef {
  id?: number;
  name: string;
  priority: number;
  segmentKey?: string | null;
  ruleGroup: RuleGroup;
  serveVariationKey: string;
  enabled: boolean;
}

export interface RolloutWeight {
  variationKey: string;
  weight: number; // 0..100
}

export interface FlagEnvironmentSnapshot {
  flagKey: string;
  flagType: FlagType;
  offVariationKey: string;
  defaultVariationKey: string;
  variations: FlagVariationDef[];
  enabled: boolean;
  killSwitch: boolean;
  envDefaultVariationKey: string;
  rolloutVariationKey: string;
  rolloutPercentage: number;
  rolloutWeights: RolloutWeight[];
  individualTargets: Record<string, string>;
  rules: TargetingRuleDef[];
  version: number;
}

export interface EvaluationContext {
  userKey: string;
  attributes?: Record<string, string | number | boolean | null | undefined>;
}

export type EvaluationReason =
  | 'KILL_SWITCH'
  | 'FLAG_DISABLED'
  | 'INDIVIDUAL_TARGET'
  | 'SEGMENT_MATCH'
  | 'TARGETING_RULE'
  | 'PERCENTAGE_ROLLOUT'
  | 'DEFAULT_VARIATION'
  | 'FALLBACK_ERROR';

export interface EvaluationResult<T = unknown> {
  flagKey: string;
  variationKey: string;
  value: T;
  reason: EvaluationReason;
  matchedRuleName?: string;
  bucket?: number;
  durationMicros: number;
}
