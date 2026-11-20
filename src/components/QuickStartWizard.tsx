import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Flag, FolderKanban, Play, Rocket, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth, type ProjectItem } from '../context/AuthContext.tsx';
import type { FlagType } from '../core/types.ts';
import type { PageRoute } from './Layout.tsx';

interface QuickStartWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: (nextRoute?: PageRoute) => void;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function buildDefaultVariations(flagType: FlagType) {
  if (flagType === 'BOOLEAN') {
    return {
      defaultVariationKey: 'off',
      offVariationKey: 'off',
      variations: [
        { variationKey: 'off', name: 'Off (Control)', value: false },
        { variationKey: 'on', name: 'On (Enabled)', value: true },
      ],
    };
  }
  if (flagType === 'STRING') {
    return {
      defaultVariationKey: 'control',
      offVariationKey: 'control',
      variations: [
        { variationKey: 'control', name: 'Control', value: 'Standard Experience' },
        { variationKey: 'treatment', name: 'Treatment', value: 'Enhanced Experience' },
      ],
    };
  }
  if (flagType === 'NUMBER') {
    return {
      defaultVariationKey: 'standard',
      offVariationKey: 'standard',
      variations: [
        { variationKey: 'standard', name: 'Standard (10)', value: 10 },
        { variationKey: 'boosted', name: 'Boosted (50)', value: 50 },
      ],
    };
  }
  return {
    defaultVariationKey: 'default',
    offVariationKey: 'default',
    variations: [
      { variationKey: 'default', name: 'Default Payload', value: { enabled: false, batchSize: 10 } },
      { variationKey: 'optimized', name: 'Optimized Payload', value: { enabled: true, batchSize: 25 } },
    ],
  };
}

export function QuickStartWizard({ open, onClose, onComplete }: QuickStartWizardProps) {
  const { projects, refreshProjects, setSelectedProjectId, notify } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [projectMode, setProjectMode] = useState<'new' | 'existing'>('new');
  const [existingProjectId, setExistingProjectId] = useState<number | ''>(projects[0]?.id ?? '');

  // Step 1 fields
  const [projectName, setProjectName] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [projectKeyTouched, setProjectKeyTouched] = useState(false);
  const [projectDescription, setProjectDescription] = useState('');

  // Step 2 fields
  const [flagName, setFlagName] = useState('');
  const [flagKey, setFlagKey] = useState('');
  const [flagKeyTouched, setFlagKeyTouched] = useState(false);
  const [flagType, setFlagType] = useState<FlagType>('BOOLEAN');
  const [flagDescription, setFlagDescription] = useState('');

  // Created artifacts for Step 3 summary & live evaluation test
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null);
  const [createdFlagId, setCreatedFlagId] = useState<number | null>(null);
  const [createdFlagKey, setCreatedFlagKey] = useState<string>('');
  const [createdFlagName, setCreatedFlagName] = useState<string>('');
  const [testUserKey, setTestUserKey] = useState('demo-user-1');
  const [testingEval, setTestingEval] = useState(false);
  const [evalOutput, setEvalOutput] = useState<{
    value: unknown;
    variationKey: string;
    reason: string;
    durationMicros: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setProjectMode('new');
    setExistingProjectId(projects[0]?.id ?? '');
    setProjectName('');
    setProjectKey('');
    setProjectKeyTouched(false);
    setProjectDescription('');
    setFlagName('');
    setFlagKey('');
    setFlagKeyTouched(false);
    setFlagType('BOOLEAN');
    setFlagDescription('');
    setActiveProject(null);
    setCreatedFlagId(null);
    setCreatedFlagKey('');
    setCreatedFlagName('');
    setTestUserKey('demo-user-1');
    setEvalOutput(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (projectMode === 'existing') {
      const chosen = projects.find((p) => p.id === Number(existingProjectId));
      if (!chosen) {
        setError('Please select an existing project to continue.');
        return;
      }
      const devEnv = chosen.environments?.find((env) => env.key === 'development');
      setActiveProject(chosen);
      setSelectedProjectId(chosen.id, devEnv?.id);
      setStep(2);
      return;
    }

    const cleanName = projectName.trim();
    const cleanKey = projectKey.trim().toLowerCase();
    if (cleanName.length < 2) {
      setError('Project name must be at least 2 characters.');
      return;
    }
    if (!/^[a-z0-9-]{2,50}$/.test(cleanKey)) {
      setError('Project key must be 2–50 lowercase letters, numbers, or hyphens.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.post<ProjectItem>('/projects', {
        name: cleanName,
        key: cleanKey,
        description: projectDescription.trim(),
      });
      const devEnv = created.environments?.find((env) => env.key === 'development');
      await refreshProjects({ projectId: created.id, environmentId: devEnv?.id });
      setActiveProject(created);
      notify('success', `Project '${created.name}' created`, 'Development, Staging, and Production are ready.');
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create project.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!activeProject) {
      setError('No project selected. Return to Step 1.');
      return;
    }

    const cleanName = flagName.trim();
    const cleanKey = flagKey.trim().toLowerCase();
    if (cleanName.length < 2) {
      setError('Flag name must be at least 2 characters.');
      return;
    }
    if (!/^[a-z0-9-]{2,80}$/.test(cleanKey)) {
      setError('Flag key must be lowercase kebab-case (e.g. smart-onboarding).');
      return;
    }

    setSubmitting(true);
    try {
      const defaults = buildDefaultVariations(flagType);
      const createdFlag = await api.post<{ id: number; key: string; name: string }>(
        `/projects/${activeProject.id}/flags`,
        {
          name: cleanName,
          key: cleanKey,
          description: flagDescription.trim(),
          flagType,
          tags: ['quick-start'],
          defaultVariationKey: defaults.defaultVariationKey,
          offVariationKey: defaults.offVariationKey,
          variations: defaults.variations,
        }
      );
      const devEnv = activeProject.environments?.find((env) => env.key === 'development');
      await refreshProjects({ projectId: activeProject.id, environmentId: devEnv?.id });
      setCreatedFlagId(createdFlag.id);
      setCreatedFlagKey(cleanKey);
      setCreatedFlagName(cleanName);
      setEvalOutput(null);
      notify('success', `Feature flag '${cleanKey}' created`, 'Enabled in Development and ready to integrate.');
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create feature flag.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLiveEvaluate = async () => {
    if (!createdFlagId || !devEnv) return;
    setTestingEval(true);
    setError(null);
    try {
      const res = await api.post<{
        value: unknown;
        variationKey: string;
        reason: string;
        durationMicros: number;
      }>(`/flags/${createdFlagId}/environments/${devEnv.id}/evaluate`, {
        userKey: testUserKey.trim() || 'demo-user-1',
        attributes: { source: 'quick-start-wizard' },
      });
      setEvalOutput(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live evaluation failed.');
    } finally {
      setTestingEval(false);
    }
  };

  const devEnv = activeProject?.environments?.find((e) => e.key === 'development') || activeProject?.environments?.[0];
  const sdkSnippet = `@FeatureEnabled(value = "${createdFlagKey || 'my-first-flag'}", fallbackMethod = "fallbackHandler")
public Response runFeature(String userKey) {
    // Runs automatically when '${createdFlagKey || 'my-first-flag'}' evaluates true
    return newFeatureFlow(userKey);
}`;

  const steps = [
    { num: 1, label: 'Project', icon: FolderKanban },
    { num: 2, label: 'Feature Flag', icon: Flag },
    { num: 3, label: 'Integrate', icon: Rocket },
  ] as const;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quickstart-wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2
              id="quickstart-wizard-title"
              className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-50"
            >
              Quick Start Wizard
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Set up a project, launch your first feature flag, and grab your SDK snippet in 3 steps.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Start wizard"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800">
          <ol className="grid grid-cols-3 gap-2">
            {steps.map((s) => {
              const Icon = s.icon;
              const isCompleted = step > s.num;
              const isCurrent = step === s.num;
              return (
                <li
                  key={s.num}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
                    isCurrent
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
                      : isCompleted
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                      isCompleted
                        ? 'bg-emerald-600 text-white'
                        : isCurrent
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {isCompleted ? <Check className="h-3 w-3" /> : s.num}
                  </span>
                  <Icon className="h-3.5 w-3.5 hidden sm:block shrink-0" />
                  <span className="truncate">{s.label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Body */}
        <div className="p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {step === 1 && (
            <form onSubmit={handleStep1Submit} className="space-y-4">
              {projects.length > 0 && (
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
                  <button
                    type="button"
                    onClick={() => {
                      setProjectMode('new');
                      setError(null);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      projectMode === 'new'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Create New Project
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectMode('existing');
                      setError(null);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      projectMode === 'existing'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Use Existing Project
                  </button>
                </div>
              )}

              {projectMode === 'existing' ? (
                <div>
                  <label htmlFor="qs-existing-proj" className="block text-xs font-medium mb-1.5">
                    Select Project
                  </label>
                  <select
                    id="qs-existing-proj"
                    value={existingProjectId}
                    onChange={(e) => setExistingProjectId(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.key})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="qs-proj-name" className="block text-xs font-medium mb-1.5">
                        Project Name
                      </label>
                      <input
                        id="qs-proj-name"
                        required
                        value={projectName}
                        onChange={(e) => {
                          setProjectName(e.target.value);
                          if (!projectKeyTouched) setProjectKey(slugify(e.target.value));
                        }}
                        placeholder="Growth Experiments"
                        className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label htmlFor="qs-proj-key" className="block text-xs font-medium mb-1.5">
                        Project Key
                      </label>
                      <input
                        id="qs-proj-key"
                        required
                        value={projectKey}
                        onChange={(e) => {
                          setProjectKeyTouched(true);
                          setProjectKey(e.target.value.toLowerCase());
                        }}
                        placeholder="growth-experiments"
                        className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="qs-proj-desc" className="block text-xs font-medium mb-1.5">
                      Description (optional)
                    </label>
                    <input
                      id="qs-proj-desc"
                      value={projectDescription}
                      onChange={(e) => setProjectDescription(e.target.value)}
                      placeholder="Feature releases for onboarding and conversion optimization."
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Development, Staging, and Production (with 2-person approval gate) environments are provisioned automatically.
                  </p>
                </>
              )}

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  {submitting
                    ? 'Creating Project...'
                    : projectMode === 'existing'
                      ? 'Continue to Flag'
                      : 'Create Project & Continue'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleStep2Submit} className="space-y-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                Target Project:{' '}
                <strong className="text-slate-900 dark:text-slate-100">{activeProject?.name}</strong>{' '}
                <span className="font-mono text-slate-500">({activeProject?.key})</span>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="qs-flag-name" className="block text-xs font-medium mb-1.5">
                    Feature Flag Name
                  </label>
                  <input
                    id="qs-flag-name"
                    required
                    value={flagName}
                    onChange={(e) => {
                      setFlagName(e.target.value);
                      if (!flagKeyTouched) setFlagKey(slugify(e.target.value));
                    }}
                    placeholder="Smart Onboarding Flow"
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="qs-flag-key" className="block text-xs font-medium mb-1.5">
                    Unique Flag Key
                  </label>
                  <input
                    id="qs-flag-key"
                    required
                    value={flagKey}
                    onChange={(e) => {
                      setFlagKeyTouched(true);
                      setFlagKey(e.target.value.toLowerCase());
                    }}
                    placeholder="smart-onboarding-flow"
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="qs-flag-type" className="block text-xs font-medium mb-1.5">
                    Flag Type
                  </label>
                  <select
                    id="qs-flag-type"
                    value={flagType}
                    onChange={(e) => setFlagType(e.target.value as FlagType)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    <option value="BOOLEAN">Boolean (true / false)</option>
                    <option value="STRING">String (copy / variants)</option>
                    <option value="NUMBER">Number (limits / thresholds)</option>
                    <option value="JSON">JSON (structured config)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="qs-flag-desc" className="block text-xs font-medium mb-1.5">
                    Description (optional)
                  </label>
                  <input
                    id="qs-flag-desc"
                    value={flagDescription}
                    onChange={(e) => setFlagDescription(e.target.value)}
                    placeholder="Gradual rollout for guided user onboarding."
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3.5 py-2.5 text-xs space-y-1">
                <p className="font-medium text-slate-700 dark:text-slate-200">
                  Auto-provisioned variations ({flagType})
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600 dark:text-slate-400">
                  {buildDefaultVariations(flagType).variations.map((v) => (
                    <span key={v.variationKey}>
                      <span className="font-mono text-slate-900 dark:text-slate-100">{v.variationKey}</span>
                      {' = '}
                      <span className="font-mono">{JSON.stringify(v.value)}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setError(null);
                  }}
                  className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  {submitting ? 'Creating Flag...' : 'Create Feature Flag'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 space-y-1">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  Workspace Ready — Project & Flag Created
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Flag <span className="font-mono font-semibold">{createdFlagKey}</span> ({createdFlagName}) is now live in{' '}
                  <strong>{activeProject?.name}</strong> (100% enabled in Development, 0% safe default in Production).
                </p>
              </div>

              {devEnv && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Development Environment SDK Key
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(devEnv.sdkKeyPlainPreview);
                        notify('info', 'Copied Development SDK key');
                      }}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                      <Copy className="h-3 w-3" />
                      Copy Key
                    </button>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-xs break-all">
                    {devEnv.sdkKeyPlainPreview}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Spring Boot Starter Usage
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(sdkSnippet);
                      notify('info', 'Copied Spring Boot code snippet');
                    }}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copy Code
                  </button>
                </div>
                <pre className="p-3.5 rounded-lg bg-slate-950 text-slate-100 font-mono text-xs overflow-x-auto leading-relaxed">
                  {sdkSnippet}
                </pre>
              </div>

              {createdFlagId && devEnv && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      Test Live Flag Evaluation (Development)
                    </span>
                    {evalOutput && (
                      <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {evalOutput.durationMicros.toFixed(1)} µs · {evalOutput.reason}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="qs-eval-user" className="sr-only">
                      Test User Key
                    </label>
                    <input
                      id="qs-eval-user"
                      value={testUserKey}
                      onChange={(e) => setTestUserKey(e.target.value)}
                      placeholder="demo-user-1"
                      className="h-9 flex-1 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() => void handleLiveEvaluate()}
                      disabled={testingEval}
                      className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      {testingEval ? 'Evaluating...' : 'Test Evaluation'}
                    </button>
                  </div>
                  {evalOutput && (
                    <div className="text-xs text-slate-700 dark:text-slate-300 font-mono bg-white dark:bg-slate-900 rounded-md px-3 py-2 border border-slate-200 dark:border-slate-800">
                      variation: <strong>{evalOutput.variationKey}</strong> · value:{' '}
                      <strong>{JSON.stringify(evalOutput.value)}</strong>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onComplete('targeting');
                  }}
                  className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Configure Targeting Rules
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onComplete('flags');
                  }}
                  className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                >
                  View Feature Flags
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
