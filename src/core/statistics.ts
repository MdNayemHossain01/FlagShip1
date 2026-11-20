export interface VariationMetricsInput {
  variationKey: string;
  name: string;
  isControl: boolean;
  expectedWeight: number;
  exposures: number;
  conversions: number;
}

export interface VariationAnalysis {
  variationKey: string;
  name: string;
  isControl: boolean;
  expectedWeight: number;
  observedShare: number;
  exposures: number;
  conversions: number;
  conversionRate: number;
  relativeLift: number | null;
  zScore: number | null;
  pValue: number | null;
  statisticallySignificant: boolean;
  confidenceInterval95: [number, number];
}

export interface SrmResult {
  chiSquare: number;
  degreesOfFreedom: number;
  pValue: number;
  mismatchDetected: boolean;
  severity: 'OK' | 'WARNING' | 'CRITICAL';
  totalExposures: number;
}

export interface ExperimentReport {
  variations: VariationAnalysis[];
  srm: SrmResult;
  winningVariationKey: string | null;
  assumptions: string[];
  limitations: string[];
}

// Standard normal CDF approximation (Abramowitz & Stegun 7.1.26)
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * erf);
}

// Regularized upper incomplete gamma approximation for Chi-Square p-value
function logGamma(z: number): number {
  const coeffs = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += coeffs[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function chiSquarePValue(chiSq: number, df: number): number {
  if (chiSq <= 0 || df <= 0) return 1;
  if (df === 1) {
    return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.sqrt(chiSq)))));
  }
  const a = df / 2;
  const x = chiSq / 2;
  if (x < a + 1) {
    // Series expansion for lower gamma
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 100; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-10) break;
    }
    const lower = sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    return Math.max(0, Math.min(1, 1 - lower));
  }
  // Continued fraction for upper gamma
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 100; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-10) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - logGamma(a)) * h));
}

export function detectSampleRatioMismatch(inputs: VariationMetricsInput[]): SrmResult {
  const totalExposures = inputs.reduce((acc, v) => acc + v.exposures, 0);
  const totalWeight = inputs.reduce((acc, v) => acc + Math.max(0, v.expectedWeight), 0);
  const df = Math.max(1, inputs.length - 1);

  if (totalExposures === 0 || totalWeight === 0 || inputs.length < 2) {
    return {
      chiSquare: 0,
      degreesOfFreedom: df,
      pValue: 1,
      mismatchDetected: false,
      severity: 'OK',
      totalExposures,
    };
  }

  let chiSquare = 0;
  for (const v of inputs) {
    const expected = (v.expectedWeight / totalWeight) * totalExposures;
    if (expected > 0) {
      chiSquare += Math.pow(v.exposures - expected, 2) / expected;
    }
  }

  const pValue = chiSquarePValue(chiSquare, df);
  const mismatchDetected = totalExposures >= 50 && pValue < 0.001;
  const severity: 'OK' | 'WARNING' | 'CRITICAL' = mismatchDetected
    ? 'CRITICAL'
    : totalExposures >= 50 && pValue < 0.01
      ? 'WARNING'
      : 'OK';

  return {
    chiSquare: Number(chiSquare.toFixed(4)),
    degreesOfFreedom: df,
    pValue: Number(pValue.toFixed(6)),
    mismatchDetected,
    severity,
    totalExposures,
  };
}

export function analyzeExperiment(inputs: VariationMetricsInput[]): ExperimentReport {
  const totalExposures = inputs.reduce((sum, v) => sum + v.exposures, 0);
  const control = inputs.find((v) => v.isControl) || inputs[0];
  const controlRate = control && control.exposures > 0 ? control.conversions / control.exposures : 0;

  const variations: VariationAnalysis[] = inputs.map((v) => {
    const rate = v.exposures > 0 ? v.conversions / v.exposures : 0;
    const seSelf = v.exposures > 0 ? Math.sqrt((rate * (1 - rate)) / v.exposures) : 0;
    const ciLow = Math.max(0, rate - 1.96 * seSelf);
    const ciHigh = Math.min(1, rate + 1.96 * seSelf);

    let relativeLift: number | null = null;
    let zScore: number | null = null;
    let pValue: number | null = null;
    let statisticallySignificant = false;

    if (control && v.variationKey !== control.variationKey && control.exposures > 0 && v.exposures > 0) {
      relativeLift = controlRate > 0 ? ((rate - controlRate) / controlRate) * 100 : null;
      const pooled = (control.conversions + v.conversions) / (control.exposures + v.exposures);
      const se = Math.sqrt(pooled * (1 - pooled) * (1 / control.exposures + 1 / v.exposures));
      if (se > 0) {
        zScore = Number(((rate - controlRate) / se).toFixed(4));
        pValue = Number((2 * (1 - normalCdf(Math.abs(zScore)))).toFixed(6));
        statisticallySignificant = pValue < 0.05 && control.exposures >= 30 && v.exposures >= 30;
      }
    }

    return {
      variationKey: v.variationKey,
      name: v.name,
      isControl: v.isControl,
      expectedWeight: v.expectedWeight,
      observedShare: totalExposures > 0 ? Number(((v.exposures / totalExposures) * 100).toFixed(2)) : 0,
      exposures: v.exposures,
      conversions: v.conversions,
      conversionRate: Number((rate * 100).toFixed(2)),
      relativeLift: relativeLift !== null ? Number(relativeLift.toFixed(2)) : null,
      zScore,
      pValue,
      statisticallySignificant,
      confidenceInterval95: [Number((ciLow * 100).toFixed(2)), Number((ciHigh * 100).toFixed(2))],
    };
  });

  const srm = detectSampleRatioMismatch(inputs);
  let winningVariationKey: string | null = null;
  if (!srm.mismatchDetected) {
    const winners = variations
      .filter((v) => !v.isControl && v.statisticallySignificant && (v.relativeLift ?? 0) > 0)
      .sort((a, b) => b.conversionRate - a.conversionRate);
    if (winners.length > 0) {
      winningVariationKey = winners[0].variationKey;
    }
  }

  return {
    variations,
    srm,
    winningVariationKey,
    assumptions: [
      'Observations (user exposures) are independent and identically distributed (i.i.d.).',
      'Two-sided two-proportion Z-test assumes normal approximation (sufficient sample size n >= 30 per arm).',
      'SRM detection uses Pearson Chi-Square goodness-of-fit against configured traffic weights at alpha = 0.001.',
      'Binary conversion outcome per exposure (0 or 1); deduplication assumes one userKey per arm.',
    ],
    limitations: [
      'Repeated peeking before reaching fixed sample size inflates Type I (false positive) error rates.',
      'No Bonferroni or Holm-Bonferroni correction is applied automatically for >2 treatment arms.',
      'Does not model novelty effects, network spillover across users, or heavy-tailed continuous revenue metrics.',
      'If SRM is flagged (p < 0.001), treatment effect estimates are biased and should not be trusted for ship decisions.',
    ],
  };
}
