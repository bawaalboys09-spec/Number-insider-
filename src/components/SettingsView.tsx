import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { ApiReadinessStatus, SearchMode, SearchSettings } from '../types/school.ts';

interface SettingsViewProps {
  readiness: ApiReadinessStatus | null;
  settings: SearchSettings;
  onSaveSettings: (updated: SearchSettings) => Promise<void>;
}

export function SettingsView({ readiness, settings, onSaveSettings }: SettingsViewProps) {
  const [draft, setDraft] = useState<SearchSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveSettings(draft);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Server-Side API Readiness (Read-only, Secrets managed externally) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">API Readiness &amp; Server Integrations</h1>
          <p className="mt-1 text-sm text-slate-600">
            All API keys are securely stored server-side in environment variables / AI Studio Secrets
            and are never exposed to browser JavaScript.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 border border-slate-200 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">Gemini AI &amp; Search Grounding</span>
              {readiness?.geminiConfigured ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Configured</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Missing</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600">
              Secret: <code className="font-mono">GEMINI_API_KEY</code> · Model:{' '}
              <code className="font-mono">{readiness?.model || 'gemini-4-hydrogen'}</code>
            </p>
            {!readiness?.geminiConfigured && (
              <p className="text-xs text-amber-800 pt-1">
                Set <code className="font-mono">GEMINI_API_KEY</code> in the AI Studio{' '}
                <strong>Settings &gt; Secrets</strong> panel.
              </p>
            )}
          </div>

          <div className="p-4 border border-slate-200 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">Google Maps Places API (New)</span>
              {readiness?.googleMapsConfigured ? (
                readiness.googleMapsError ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Key Issue</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Configured</span>
                  </span>
                )
              ) : (
                <span className="text-xs font-medium text-slate-500">Optional / Not Set</span>
              )}
            </div>
            <p className="text-xs text-slate-600">
              Secret: <code className="font-mono">GOOGLE_MAPS_API_KEY</code> (optional for Place ID &amp;
              Maps listing enrichment)
            </p>
            {readiness?.googleMapsError && (
              <p className="text-xs text-amber-800 pt-1">
                {readiness.googleMapsError}
              </p>
            )}
            {!readiness?.googleMapsConfigured && (
              <p className="text-xs text-slate-500 pt-1">
                When unset, discovery runs via official website crawling and Gemini Search Grounding.
              </p>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 flex items-start gap-2.5 text-xs text-slate-600">
          <ShieldCheck className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            {(readiness?.complianceNotes ?? [
              'Respects target website robots.txt rules and safe request rate limits.',
              'Skips CAPTCHA-protected or login-walled pages without bypassing technical protections.',
              'Never fabricates or guesses phone numbers; unavailable records are marked Not Found.',
            ]).map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced Search Settings Form */}
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Advanced Search Settings</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Customize data sources, regional filters, retry counts, and rate limits.
            </p>
          </div>
          {savedNotice && (
            <span className="text-xs font-semibold text-emerald-700">Settings saved</span>
          )}
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-700">Primary Search Strategy</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(
              [
                {
                  value: 'all_public',
                  title: 'Search All Public Sources',
                  desc: 'Official websites, Google Maps, and public directories',
                },
                {
                  value: 'official_website_only',
                  title: 'Official Websites Only',
                  desc: 'Only crawl school websites provided or discovered',
                },
                {
                  value: 'google_maps_only',
                  title: 'Google Maps Places Only',
                  desc: 'Query Google Maps Places API exclusively',
                },
              ] as Array<{ value: SearchMode; title: string; desc: string }>
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, searchMode: opt.value }))}
                className={`p-3.5 text-left border rounded-lg transition-colors ${
                  draft.searchMode === opt.value
                    ? 'border-sky-600 bg-sky-50/70'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="block text-sm font-semibold text-slate-900">{opt.title}</span>
                <span className="block text-xs text-slate-600 mt-1">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {[
            { key: 'includeOfficialWebsite', label: 'Crawl Official Websites (Contact Us, About Us, Footer)' },
            { key: 'includeGoogleMaps', label: 'Query Google Maps Places API (if key configured)' },
            { key: 'includePublicSearch', label: 'Use Multi-Query Public Search & CBSE Directories' },
            {
              key: 'includeFacebookAndJustdial',
              label: 'Fallback to Facebook, Justdial & Public Directories if Google/Website has no number',
            },
            { key: 'searchMultipleNumbers', label: 'Extract Multiple Phone Numbers (Phone 1 & Phone 2)' },
            { key: 'onlyBiharSchools', label: 'Search Only Bihar Schools' },
            { key: 'missingNumbersOnly', label: 'Search Missing Numbers Only (Skip already found)' },
            { key: 'recheckFailedOnly', label: 'Recheck Previously Failed / Not Found Schools Only' },
          ].map((item) => {
            const isChecked =
              item.key === 'includeFacebookAndJustdial'
                ? draft.includeFacebookAndJustdial ?? true
                : Boolean(draft[item.key as keyof SearchSettings]);
            return (
              <label
                key={item.key}
                className="flex items-start gap-2.5 text-sm text-slate-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [item.key]: e.target.checked }))
                  }
                  className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>{item.label}</span>
              </label>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-200">
          <div>
            <label htmlFor="district-filter" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Search by District (Optional)
            </label>
            <input
              id="district-filter"
              type="text"
              value={draft.districtFilter}
              onChange={(e) => setDraft((prev) => ({ ...prev, districtFilter: e.target.value }))}
              placeholder="e.g. Patna, Gaya, Muzaffarpur"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label htmlFor="concurrency" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Parallel Workers (Speed)
            </label>
            <select
              id="concurrency"
              value={draft.concurrency || 8}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, concurrency: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value={1}>1 school at a time</option>
              <option value={3}>3 schools in parallel</option>
              <option value={5}>5 schools in parallel (Fast)</option>
              <option value={8}>8 schools in parallel (Turbo)</option>
            </select>
          </div>

          <div>
            <label htmlFor="max-attempts" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Max Search Attempts / School
            </label>
            <select
              id="max-attempts"
              value={draft.maxAttemptsPerSchool}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, maxAttemptsPerSchool: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'attempt' : 'attempts'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="batch-delay" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Rate Limit Delay
            </label>
            <select
              id="batch-delay"
              value={draft.batchDelayMs}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, batchDelayMs: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value={100}>100 ms (Turbo)</option>
              <option value={250}>250 ms (Fast)</option>
              <option value={600}>600 ms (Balanced)</option>
              <option value={1500}>1,500 ms (Conservative)</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Search Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
