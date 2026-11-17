import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  FileUp,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import type { ApiReadinessStatus, BatchJob, BatchStats } from '../types/school.ts';
import type { NavPage } from './Sidebar.tsx';

interface DashboardViewProps {
  job: BatchJob | null;
  stats: BatchStats | null;
  readiness: ApiReadinessStatus | null;
  liveFeed: string[];
  actionError: string | null;
  isBusy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetryFailed: () => void;
  onNavigate: (page: NavPage) => void;
}

export function DashboardView({
  job,
  stats,
  readiness,
  liveFeed,
  actionError,
  isBusy,
  onStart,
  onPause,
  onResume,
  onStop,
  onRetryFailed,
  onNavigate,
}: DashboardViewProps) {
  const missingGemini = readiness && !readiness.geminiConfigured;
  const runStartRef = useRef<{ time: number; baselineCompleted: number } | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (job?.status === 'running') {
      if (!runStartRef.current) {
        runStartRef.current = {
          time: Date.now(),
          baselineCompleted: stats?.completedSearches || 0,
        };
      }
      const interval = setInterval(() => {
        if (runStartRef.current) {
          setElapsedSec(Math.max(1, Math.round((Date.now() - runStartRef.current.time) / 1000)));
        }
      }, 1000);
      return () => clearInterval(interval);
    }
    runStartRef.current = null;
    setElapsedSec(0);
    return undefined;
  }, [job?.status, job?.id]);

  if (!job || !stats) {
    return (
      <div className="space-y-6">
        {missingGemini && (
          <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-amber-950">
                  Gemini API Key Required in Environment Secrets
                </h2>
                <p className="text-sm text-amber-800 mt-1">
                  Configure <code className="font-mono text-xs">GEMINI_API_KEY</code> in the AI Studio{' '}
                  <strong>Settings &gt; Secrets</strong> panel to enable automated school search and AI
                  verification.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="px-4 py-2 text-xs font-semibold text-amber-950 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 whitespace-nowrap shrink-0"
            >
              View API Readiness
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12">
          <div className="max-w-2xl">
            <p className="text-xs font-medium text-sky-700">
              Upload Excel · Find School Numbers · Export Complete Data
            </p>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Enrich your school spreadsheets with verified public contact details
            </h1>
            <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
              Upload any <span className="font-mono text-xs">.xlsx</span>,{' '}
              <span className="font-mono text-xs">.xls</span>, or{' '}
              <span className="font-mono text-xs">.csv</span> workbook of schools. School Contact Finder
              AI inspects official school websites, Contact Us pages, Google Maps listings, and public
              directories, verifies every number against school name and district, and exports a clean
              highlighted Excel sheet.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('upload')}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
              >
                <FileUp className="w-4 h-4" />
                <span>Upload School Excel</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('history')}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Open Processing History</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="mt-10 pt-8 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">01. Multi-Source Discovery</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Crawls official school websites, Contact Us &amp; About Us pages, Google Maps Places, and
                public school directories while honoring robots.txt.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">02. AI Verification &amp; Scoring</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Gemini AI cross-checks district, state, and address to reject unrelated numbers and
                assign confidence scores with exact source URLs.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">03. Preserved 16-Column Export</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Exports all original serial numbers and rows intact with Verified numbers highlighted in
                green and Unverified numbers in yellow.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pct =
    stats.totalSchools > 0
      ? Math.round((stats.completedSearches / stats.totalSchools) * 100)
      : 0;

  const isRunning = job.status === 'running';
  const isPaused = job.status === 'paused';

  const processedThisRun = runStartRef.current
    ? Math.max(0, stats.completedSearches - runStartRef.current.baselineCompleted)
    : 0;
  const ratePerMin =
    isRunning && elapsedSec >= 2 && processedThisRun > 0
      ? Math.round((processedThisRun / elapsedSec) * 60)
      : 0;
  const remainingCount = Math.max(0, stats.totalSchools - stats.completedSearches);
  const etaMinutes =
    ratePerMin > 0 && remainingCount > 0 ? Math.max(1, Math.ceil(remainingCount / ratePerMin)) : 0;

  const sourceEntries = Object.entries(stats.sourceBreakdown ?? {}).sort((a, b) => b[1] - a[1]);

  const metrics = [
    { label: 'Total Schools', value: stats.totalSchools, tone: 'text-slate-900' },
    { label: 'Completed Searches', value: stats.completedSearches, tone: 'text-sky-700' },
    { label: 'Numbers Found', value: stats.numbersFound, tone: 'text-emerald-700' },
    { label: 'Numbers Not Found', value: stats.numbersNotFound, tone: 'text-slate-600' },
    { label: 'Verified Numbers', value: stats.verifiedNumbers, tone: 'text-emerald-700' },
    { label: 'Duplicate Numbers', value: stats.duplicateNumbers, tone: 'text-amber-700' },
    { label: 'Failed Searches', value: stats.failedSearches, tone: 'text-rose-700' },
  ];

  return (
    <div className="space-y-6">
      {(missingGemini || readiness?.googleMapsError) && (
        <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm text-sky-950">
              {missingGemini && (
                <p>
                  <span className="font-semibold">
                    Running with Website Crawler
                    {readiness?.googleMapsConfigured && !readiness?.googleMapsError
                      ? ' + Google Maps Places API'
                      : ''}
                    .
                  </span>{' '}
                  Add <code className="font-mono text-xs">GEMINI_API_KEY</code> in AI Studio{' '}
                  <strong>Settings &gt; Secrets</strong> to enable Google Search Grounding, Facebook &amp;
                  Justdial fallback, and AI verification.
                </p>
              )}
              {readiness?.googleMapsError && (
                <p className="text-amber-900">
                  <span className="font-semibold">Google Maps Key Warning:</span> {readiness.googleMapsError}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="px-3 py-1.5 text-xs font-semibold text-sky-900 bg-white border border-sky-300 rounded-lg hover:bg-sky-100 whitespace-nowrap shrink-0"
          >
            API Settings
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
          {actionError}
        </div>
      )}

      {/* Batch Control Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700 capitalize">{job.status}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {stats.completedSearches} / {stats.totalSchools} processed ({pct}%)
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {stats.emailsFound ?? 0} emails found
              </span>
              {ratePerMin > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-sky-700">
                    {ratePerMin} schools/min{etaMinutes > 0 ? ` · ~${etaMinutes}m remaining` : ''}
                  </span>
                </>
              )}
            </div>
            <h1 className="mt-1 text-xl font-bold text-slate-900 truncate">{job.fileName}</h1>
            {isRunning && job.currentSchoolName && (
              <p className="mt-1 text-sm text-sky-700 font-medium truncate">
                School {job.currentIndex}/{stats.totalSchools} — Searching {job.currentSchoolName}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {!isRunning && !isPaused && (
              <button
                type="button"
                disabled={isBusy}
                onClick={onStart}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4" />
                <span>Start Search</span>
              </button>
            )}

            {isRunning && (
              <button
                type="button"
                disabled={isBusy}
                onClick={onPause}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Pause className="w-4 h-4" />
                <span>Pause Search</span>
              </button>
            )}

            {isPaused && (
              <button
                type="button"
                disabled={isBusy}
                onClick={onResume}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4" />
                <span>Resume Search</span>
              </button>
            )}

            {(isRunning || isPaused) && (
              <button
                type="button"
                disabled={isBusy}
                onClick={onStop}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-rose-700 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-4 h-4" />
                <span>Stop Search</span>
              </button>
            )}

            <button
              type="button"
              disabled={isBusy || isRunning || (stats.failedSearches === 0 && stats.numbersNotFound === 0)}
              onClick={onRetryFailed}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry Failed Schools</span>
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-5">
          <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-600 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* 7 Required KPI Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">{m.label}</p>
            <p className={`mt-2 text-2xl font-bold font-mono tabular-nums ${m.tone}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Discovery Source Breakdown */}
      {sourceEntries.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-700">Discovered Numbers by Source</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
            {sourceEntries.map(([source, count]) => (
              <span key={source}>
                <span className="font-medium text-slate-800">{source}</span>{' '}
                <span className="font-mono tabular-nums text-sky-700 font-semibold">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Live Processing Stream & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Live Processing Activity</h2>
            <button
              type="button"
              onClick={() => onNavigate('results')}
              className="text-xs font-semibold text-sky-700 hover:text-sky-800 whitespace-nowrap"
            >
              View All {stats.totalSchools} Schools
            </button>
          </div>
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {liveFeed.length > 0 ? (
              liveFeed.map((entry, idx) => (
                <div key={`${idx}-${entry}`} className="px-5 py-3 text-xs font-mono text-slate-700">
                  {entry}
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-sm text-slate-500">
                Click <strong>Start Search</strong> to begin multi-source contact discovery and AI
                verification. Live per-school updates will appear here.
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Active Search Configuration</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Official Websites</dt>
                <dd className="font-medium text-slate-900">
                  {job.settings.includeOfficialWebsite ? 'Enabled' : 'Disabled'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Google Maps Places</dt>
                <dd className="font-medium text-slate-900">
                  {job.settings.includeGoogleMaps
                    ? readiness?.googleMapsConfigured
                      ? readiness.googleMapsError
                        ? 'Key Issue'
                        : 'Active'
                      : 'Key Not Set'
                    : 'Disabled'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Public Search Grounding</dt>
                <dd className="font-medium text-slate-900">
                  {job.settings.includePublicSearch ? 'Enabled' : 'Disabled'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Facebook &amp; Justdial Fallback</dt>
                <dd className="font-medium text-slate-900">
                  {(job.settings.includeFacebookAndJustdial ?? true) ? 'Enabled' : 'Disabled'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Bihar Only Filter</dt>
                <dd className="font-medium text-slate-900">
                  {job.settings.onlyBiharSchools ? 'Yes' : 'All States'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Max Attempts / School</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900">
                  {job.settings.maxAttemptsPerSchool}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 whitespace-nowrap"
            >
              Adjust Search Settings
            </button>
            <button
              type="button"
              onClick={() => onNavigate('export')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 whitespace-nowrap shrink-0"
            >
              Export Excel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
