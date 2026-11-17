/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { FileUp, Menu } from 'lucide-react';
import type {
  ApiReadinessStatus,
  BatchJob,
  BatchJobSummary,
  BatchStats,
  SchoolRecord,
  SearchSettings,
} from './types/school.ts';
import { DashboardView } from './components/DashboardView.tsx';
import { ExportView } from './components/ExportView.tsx';
import { HistoryView } from './components/HistoryView.tsx';
import { ResultsView } from './components/ResultsView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { Sidebar, type NavPage } from './components/Sidebar.tsx';
import { UploadView } from './components/UploadView.tsx';

const DEFAULT_SETTINGS: SearchSettings = {
  searchMode: 'all_public',
  includeGoogleMaps: true,
  includeOfficialWebsite: true,
  includePublicSearch: true,
  includeFacebookAndJustdial: true,
  searchMultipleNumbers: true,
  onlyBiharSchools: false,
  districtFilter: '',
  missingNumbersOnly: false,
  recheckFailedOnly: false,
  maxAttemptsPerSchool: 1,
  batchDelayMs: 100,
  concurrency: 8,
};

const PAGE_LABELS: Record<NavPage, string> = {
  dashboard: 'Dashboard',
  upload: 'Upload Excel',
  results: 'Search Results',
  history: 'Processing History',
  export: 'Export Excel',
  settings: 'API Settings',
};

export default function App() {
  const [activePage, setActivePage] = useState<NavPage>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [readiness, setReadiness] = useState<ApiReadinessStatus | null>(null);
  const [historyJobs, setHistoryJobs] = useState<BatchJobSummary[]>([]);
  const [activeJob, setActiveJob] = useState<BatchJob | null>(null);
  const [activeStats, setActiveStats] = useState<BatchStats | null>(null);
  const [globalSettings, setGlobalSettings] = useState<SearchSettings>(DEFAULT_SETTINGS);

  const [liveFeed, setLiveFeed] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const fetchReadiness = useCallback(async () => {
    try {
      const res = await fetch('/api/readiness');
      if (res.ok) {
        const data = (await res.json()) as ApiReadinessStatus;
        setReadiness(data);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data = (await res.json()) as { jobs: BatchJobSummary[] };
        setHistoryJobs(data.jobs);
        return data.jobs;
      }
    } catch {
      // ignore
    }
    return [];
  }, []);

  const loadJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { job: BatchJob; stats: BatchStats };
      setActiveJob(data.job);
      setActiveStats(data.stats);
      setGlobalSettings(data.job.settings);
      setActionError(null);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchReadiness();
    void fetchHistory().then((jobs) => {
      if (jobs.length > 0 && !activeJob) {
        void loadJob(jobs[0].id);
      }
    });
  }, [fetchReadiness, fetchHistory, loadJob]);

  // Subscribe to SSE stream when an active job is loaded
  useEffect(() => {
    if (!activeJob?.id) return;
    const jobId = activeJob.id;
    const eventSource = new EventSource(`/api/jobs/${jobId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: 'progress' | 'status';
          jobId: string;
          jobStatus: BatchJob['status'];
          currentIndex: number;
          currentSchoolName?: string;
          message: string;
          school?: SchoolRecord;
          stats: BatchStats;
        };

        setActiveStats(payload.stats);
        setActiveJob((prev) => {
          if (!prev || prev.id !== payload.jobId) return prev;
          const updatedSchools = payload.school
            ? prev.schools.map((s) => (s.id === payload.school!.id ? payload.school! : s))
            : prev.schools;
          return {
            ...prev,
            status: payload.jobStatus,
            currentIndex: payload.currentIndex,
            currentSchoolName: payload.currentSchoolName,
            schools: updatedSchools,
          };
        });

        if (payload.type === 'progress' || payload.message.includes('completed') || payload.message.includes('paused') || payload.message.includes('stopped')) {
          setLiveFeed((prev) => [payload.message, ...prev].slice(0, 60));
        }

        if (payload.type === 'status') {
          void fetchHistory();
        }
      } catch {
        // ignore parse error
      }
    };

    return () => {
      eventSource.close();
    };
  }, [activeJob?.id, fetchHistory]);

  const callBatchControl = async (endpoint: 'start' | 'pause' | 'resume' | 'stop' | 'retry-failed') => {
    if (!activeJob) return;
    setIsBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/jobs/${activeJob.id}/${endpoint}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Action ${endpoint} failed`);
      }
      await loadJob(activeJob.id);
      await fetchHistory();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Batch action failed');
    } finally {
      setIsBusy(false);
    }
  };

  const handleBatchCreated = async (jobId: string) => {
    setLiveFeed([]);
    await loadJob(jobId);
    await fetchHistory();
    setActivePage('dashboard');
  };

  const handleRetrySchool = async (schoolId: string) => {
    if (!activeJob) return;
    const res = await fetch(`/api/jobs/${activeJob.id}/schools/${schoolId}/retry`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error || 'Failed to retry school');
      return;
    }
    setActiveJob((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        schools: prev.schools.map((s) => (s.id === schoolId ? (data.school as SchoolRecord) : s)),
      };
    });
    setActiveStats(data.stats as BatchStats);
    await fetchHistory();
  };

  const handleDeleteJob = async (jobId: string) => {
    await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    if (activeJob?.id === jobId) {
      setActiveJob(null);
      setActiveStats(null);
      setLiveFeed([]);
    }
    await fetchHistory();
  };

  const handleSaveSettings = async (updated: SearchSettings) => {
    setGlobalSettings(updated);
    if (activeJob) {
      const res = await fetch(`/api/jobs/${activeJob.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        setActiveJob((prev) => (prev ? { ...prev, settings: updated } : prev));
      }
    }
  };

  const activeProgressText =
    activeJob && activeStats
      ? `${activeStats.completedSearches}/${activeStats.totalSchools} completed`
      : undefined;

  return (
    <div className="min-h-screen flex bg-slate-50/70 text-slate-900">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        activeJobName={activeJob?.fileName}
        activeJobProgress={activeProgressText}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500">Workspace</span>
              <span className="text-slate-300" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 truncate">{PAGE_LABELS[activePage]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActivePage('upload')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>Upload Excel</span>
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {activePage === 'dashboard' && (
            <DashboardView
              job={activeJob}
              stats={activeStats}
              readiness={readiness}
              liveFeed={liveFeed}
              actionError={actionError}
              isBusy={isBusy}
              onStart={() => void callBatchControl('start')}
              onPause={() => void callBatchControl('pause')}
              onResume={() => void callBatchControl('resume')}
              onStop={() => void callBatchControl('stop')}
              onRetryFailed={() => void callBatchControl('retry-failed')}
              onNavigate={setActivePage}
            />
          )}

          {activePage === 'upload' && (
            <UploadView onBatchCreated={(jobId) => void handleBatchCreated(jobId)} />
          )}

          {activePage === 'results' && (
            <ResultsView
              job={activeJob}
              onRetrySchool={handleRetrySchool}
              onNavigateUpload={() => setActivePage('upload')}
            />
          )}

          {activePage === 'history' && (
            <HistoryView
              jobs={historyJobs}
              activeJobId={activeJob?.id}
              onSelectJob={(jobId) => {
                void loadJob(jobId).then(() => setActivePage('dashboard'));
              }}
              onDeleteJob={(jobId) => void handleDeleteJob(jobId)}
              onNavigateUpload={() => setActivePage('upload')}
            />
          )}

          {activePage === 'export' && (
            <ExportView
              job={activeJob}
              onNavigateUpload={() => setActivePage('upload')}
            />
          )}

          {activePage === 'settings' && (
            <SettingsView
              readiness={readiness}
              settings={activeJob?.settings || globalSettings}
              onSaveSettings={handleSaveSettings}
            />
          )}
        </main>
      </div>
    </div>
  );
}
