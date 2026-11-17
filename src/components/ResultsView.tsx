import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  MapPin,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import type { BatchJob, SchoolRecord } from '../types/school.ts';

interface ResultsViewProps {
  job: BatchJob | null;
  onRetrySchool: (schoolId: string) => Promise<void>;
  onNavigateUpload: () => void;
}

type FilterTab = 'all' | 'verified' | 'unverified' | 'not_found' | 'failed' | 'duplicate';

export function ResultsView({ job, onRetrySchool, onNavigateUpload }: ResultsViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [districtFilter, setDistrictFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (val: string, key: string) => {
    if (!val || val === 'Not Found') return;
    void navigator.clipboard?.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 1400);
  };

  const districts = useMemo(() => {
    if (!job) return [];
    const set = new Set<string>();
    for (const s of job.schools) {
      if (s.district.trim()) set.add(s.district.trim());
    }
    return Array.from(set).sort();
  }, [job]);

  const sources = useMemo(() => {
    if (!job) return [];
    const set = new Set<string>();
    for (const s of job.schools) {
      const src = s.enriched.candidates?.[0]?.sourceType;
      if (src) set.add(src);
    }
    return Array.from(set).sort();
  }, [job]);

  const filteredSchools = useMemo(() => {
    if (!job) return [];
    const q = searchTerm.toLowerCase().trim();
    return job.schools.filter((s) => {
      if (districtFilter && s.district.trim() !== districtFilter) return false;
      if (sourceFilter && s.enriched.candidates?.[0]?.sourceType !== sourceFilter) return false;
      if (filterTab === 'verified' && s.enriched.verificationStatus !== 'Verified') return false;
      if (filterTab === 'unverified' && s.enriched.verificationStatus !== 'Unverified') return false;
      if (filterTab === 'not_found' && s.enriched.verificationStatus !== 'Not Found') return false;
      if (filterTab === 'failed' && s.status !== 'Failed') return false;
      if (filterTab === 'duplicate' && !s.enriched.isDuplicate && s.status !== 'Duplicate') return false;

      if (!q) return true;
      return (
        s.schoolName.toLowerCase().includes(q) ||
        s.district.toLowerCase().includes(q) ||
        s.enriched.phone1.toLowerCase().includes(q) ||
        s.enriched.mobileNumber.toLowerCase().includes(q) ||
        s.enriched.emailAddress.toLowerCase().includes(q) ||
        s.affiliationNumber.toLowerCase().includes(q) ||
        s.schoolCode.toLowerCase().includes(q)
      );
    });
  }, [job, searchTerm, filterTab, districtFilter, sourceFilter]);

  const selectedSchool: SchoolRecord | null = useMemo(() => {
    if (!job || !selectedSchoolId) return null;
    return job.schools.find((s) => s.id === selectedSchoolId) || null;
  }, [job, selectedSchoolId]);

  if (!job) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h2 className="text-lg font-bold text-slate-900">No School Data Loaded</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload an Excel or CSV file first to inspect discovered school phone numbers and sources.
        </p>
        <button
          type="button"
          onClick={onNavigateUpload}
          className="mt-5 px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700"
        >
          Upload Excel File
        </button>
      </div>
    );
  }

  const handleRetry = async (schoolId: string) => {
    setRetryingId(schoolId);
    try {
      await onRetrySchool(schoolId);
    } finally {
      setRetryingId(null);
    }
  };

  const tabs: Array<{ id: FilterTab; label: string }> = [
    { id: 'all', label: 'All Schools' },
    { id: 'verified', label: 'Verified' },
    { id: 'unverified', label: 'Unverified' },
    { id: 'not_found', label: 'Not Found' },
    { id: 'failed', label: 'Failed' },
    { id: 'duplicate', label: 'Duplicates' },
  ];

  return (
    <div className="space-y-4">
      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search school name, district, phone, or affiliation no..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
              aria-label="Filter by district"
            >
              <option value="">All Districts</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {sources.length > 0 && (
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                aria-label="Filter by source"
              >
                <option value="">All Sources</option>
                {sources.map((src) => (
                  <option key={src} value={src}>
                    {src}
                  </option>
                ))}
              </select>
            )}
            <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
              {filteredSchools.length} / {job.schools.length} shown
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filterTab === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="px-4 py-3 whitespace-nowrap">S.No.</th>
                <th className="px-4 py-3">School Name</th>
                <th className="px-4 py-3 whitespace-nowrap">District / State</th>
                <th className="px-4 py-3 whitespace-nowrap">Contact Number</th>
                <th className="px-4 py-3 whitespace-nowrap">Mobile Number</th>
                <th className="px-4 py-3 whitespace-nowrap">Email Address</th>
                <th className="px-4 py-3 whitespace-nowrap">Source</th>
                <th className="px-4 py-3 whitespace-nowrap">Confidence</th>
                <th className="px-4 py-3 whitespace-nowrap">Verification</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredSchools.map((school) => {
                const vStatus = school.enriched.verificationStatus;
                const isSearching = school.status === 'Searching';
                const isFailed = school.status === 'Failed';
                const primarySource = school.enriched.candidates?.[0]?.sourceType || '—';

                return (
                  <tr
                    key={school.id}
                    onClick={() => setSelectedSchoolId(school.id)}
                    className="hover:bg-sky-50/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {school.sNo}
                    </td>
                    <td className="px-4 py-3 min-w-[220px]">
                      <div className="font-medium text-slate-900">{school.schoolName || 'Missing Name'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {school.affiliationNumber ? `Aff: ${school.affiliationNumber}` : 'No Aff. No.'}
                        {school.enriched.isDuplicate ? ' · Duplicate flagged' : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {[school.district, school.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td
                      className={`px-4 py-3 font-mono tabular-nums whitespace-nowrap ${
                        school.enriched.phone1 !== 'Not Found'
                          ? vStatus === 'Verified'
                            ? 'text-emerald-800 bg-emerald-50/60 font-medium'
                            : 'text-amber-800 bg-amber-50/60 font-medium'
                          : 'text-slate-400'
                      }`}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <span>{school.enriched.phone1}</span>
                        {school.enriched.phone1 !== 'Not Found' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(school.enriched.phone1, `${school.id}-p1`);
                            }}
                            className="p-0.5 text-slate-400 hover:text-slate-700"
                            title="Copy contact number"
                            aria-label="Copy contact number"
                          >
                            {copiedKey === `${school.id}-p1` ? (
                              <Check className="w-3 h-3 text-emerald-700" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-4 py-3 font-mono tabular-nums whitespace-nowrap ${
                        school.enriched.mobileNumber !== 'Not Found'
                          ? vStatus === 'Verified'
                            ? 'text-emerald-800 bg-emerald-50/60 font-medium'
                            : 'text-amber-800 bg-amber-50/60 font-medium'
                          : 'text-slate-400'
                      }`}
                    >
                      {school.enriched.mobileNumber}
                    </td>
                    <td
                      className={`px-4 py-3 font-mono text-xs max-w-[210px] truncate ${
                        school.enriched.emailAddress !== 'Not Found'
                          ? 'text-slate-800 font-medium'
                          : 'text-slate-400'
                      }`}
                      title={school.enriched.emailAddress}
                    >
                      <div className="inline-flex items-center gap-1.5 max-w-full">
                        <span className="truncate">{school.enriched.emailAddress}</span>
                        {school.enriched.emailAddress !== 'Not Found' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(school.enriched.emailAddress, `${school.id}-email`);
                            }}
                            className="p-0.5 text-slate-400 hover:text-slate-700 shrink-0"
                            title="Copy email address"
                            aria-label="Copy email address"
                          >
                            {copiedKey === `${school.id}-email` ? (
                              <Check className="w-3 h-3 text-emerald-700" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {primarySource}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {school.enriched.confidenceScore > 0 ? `${school.enriched.confidenceScore}%` : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isSearching ? (
                        <span className="text-xs font-medium text-sky-700">Searching...</span>
                      ) : isFailed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>Failed</span>
                        </span>
                      ) : vStatus === 'Verified' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Verified</span>
                        </span>
                      ) : vStatus === 'Unverified' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>Unverified</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {school.status === 'Pending' ? 'Pending' : 'Not Found'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={retryingId === school.id || isSearching}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRetry(school.id);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{retryingId === school.id ? 'Running' : 'Retry'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredSchools.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                    No schools match the current search or filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* School Detail Slide-Over */}
      {selectedSchool && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto border-l border-slate-200 p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <p className="text-xs font-mono text-slate-500">
                  S.No. {selectedSchool.sNo}
                  {selectedSchool.affiliationNumber ? ` · Aff ${selectedSchool.affiliationNumber}` : ''}
                  {selectedSchool.schoolCode ? ` · Code ${selectedSchool.schoolCode}` : ''}
                </p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">{selectedSchool.schoolName}</h2>
                <p className="text-sm text-slate-600">
                  {[selectedSchool.district, selectedSchool.state].filter(Boolean).join(', ')}
                  {selectedSchool.principalName ? ` · Principal: ${selectedSchool.principalName}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSchoolId(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
                aria-label="Close detail panel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedSchool.errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
                {selectedSchool.errorMessage}
              </div>
            )}

            {selectedSchool.enriched.duplicateReason && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                {selectedSchool.enriched.duplicateReason}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500">Phone Number 1</p>
                <p className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                  {selectedSchool.enriched.phone1}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Phone Number 2</p>
                <p className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                  {selectedSchool.enriched.phone2}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Mobile Number</p>
                <p className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                  {selectedSchool.enriched.mobileNumber}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Principal Contact</p>
                <p className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                  {selectedSchool.enriched.principalContact}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500">Email Address</p>
                <p className="mt-0.5 font-mono text-slate-900 break-all">
                  {selectedSchool.enriched.emailAddress}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500">Official Website</p>
                {selectedSchool.enriched.officialWebsite !== 'Not Found' ? (
                  <a
                    href={selectedSchool.enriched.officialWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-sky-700 hover:underline break-all"
                  >
                    <span>{selectedSchool.enriched.officialWebsite}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                ) : (
                  <p className="mt-0.5 text-slate-500">Not Found</p>
                )}
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500">Complete School Address</p>
                <p className="mt-0.5 text-slate-800">{selectedSchool.enriched.address}</p>
              </div>
              {selectedSchool.enriched.googleMapsUrl && (
                <div className="col-span-2">
                  <a
                    href={selectedSchool.enriched.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:underline"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Open Google Maps Listing</span>
                  </a>
                </div>
              )}
            </div>

            {selectedSchool.enriched.verificationNotes && (
              <div className="pt-4 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-700">AI Verification Notes</p>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                  {selectedSchool.enriched.verificationNotes}
                </p>
              </div>
            )}

            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-xs font-semibold text-slate-700">
                Verified Source Attribution ({selectedSchool.enriched.candidates.length})
              </h3>
              {selectedSchool.enriched.candidates.length > 0 ? (
                <div className="mt-3 divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {selectedSchool.enriched.candidates.map((cand, idx) => (
                    <div key={idx} className="p-3 space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-sm text-slate-900">
                          {cand.phoneNumber}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600">
                          {cand.confidenceScore}% · {cand.verificationStatus}
                        </span>
                      </div>
                      <p className="text-slate-600">
                        {cand.sourceType} · {cand.sourceWebsite} · Role: {cand.role}
                      </p>
                      <a
                        href={cand.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sky-700 hover:underline break-all"
                      >
                        <span>{cand.sourceUrl}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                      {cand.notes && <p className="text-slate-500 pt-0.5">{cand.notes}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  No verified phone candidates recorded for this school yet.
                </p>
              )}
            </div>

            <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={retryingId === selectedSchool.id}
                onClick={() => void handleRetry(selectedSchool.id)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{retryingId === selectedSchool.id ? 'Searching...' : 'Re-run School Search'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
