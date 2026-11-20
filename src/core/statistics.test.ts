import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeExperiment, detectSampleRatioMismatch } from './statistics.ts';

test('Experiment analysis detects statistically significant positive lift without SRM', () => {
  const report = analyzeExperiment([
    {
      variationKey: 'control',
      name: 'Control',
      isControl: true,
      expectedWeight: 50,
      exposures: 5020,
      conversions: 502, // 10.00%
    },
    {
      variationKey: 'treatment',
      name: 'One-Click Checkout',
      isControl: false,
      expectedWeight: 50,
      exposures: 4980,
      conversions: 647, // ~12.99%
    },
  ]);

  assert.equal(report.srm.mismatchDetected, false);
  assert.equal(report.srm.severity, 'OK');
  assert.equal(report.winningVariationKey, 'treatment');
  const treatment = report.variations.find((v) => v.variationKey === 'treatment')!;
  assert.equal(treatment.statisticallySignificant, true);
  assert.ok((treatment.relativeLift ?? 0) > 25);
  assert.ok((treatment.pValue ?? 1) < 0.001);
});

test('SRM detector flags severely imbalanced 50/50 split and suppresses winner call', () => {
  const srm = detectSampleRatioMismatch([
    { variationKey: 'control', name: 'Control', isControl: true, expectedWeight: 50, exposures: 6000, conversions: 600 },
    { variationKey: 'variant', name: 'Variant', isControl: false, expectedWeight: 50, exposures: 4000, conversions: 520 },
  ]);

  assert.equal(srm.mismatchDetected, true);
  assert.equal(srm.severity, 'CRITICAL');
  assert.ok(srm.pValue < 0.001);

  const report = analyzeExperiment([
    { variationKey: 'control', name: 'Control', isControl: true, expectedWeight: 50, exposures: 6000, conversions: 600 },
    { variationKey: 'variant', name: 'Variant', isControl: false, expectedWeight: 50, exposures: 4000, conversions: 520 },
  ]);
  assert.equal(report.winningVariationKey, null);
});
