import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import type { BatchJob } from '../types/school.ts';

interface ExportViewProps {
  job: BatchJob | null;
  onNavigateUpload: () => void;
}

const STANDARD_HEADERS = [
  'S.No.',
  'School Name',
  'Affiliation Number',
  'School Code',
  'District',
  'State',
  'Address',
  'Official Website',
  'Phone Number 1',
  'Phone Number 2',
  'Mobile Number',
  'Email Address',
  'Principal Contact',
  'Source URL',
  'Confidence Score',
  'Verification Status',
];

export function ExportView({ job, onNavigateUpload }: ExportViewProps) {
  const [exportFormat, setExportFormat] = useState<'original' | 'standard'>('original');

  if (!job) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h2 className="text-lg font-bold text-slate-900">Nothing to Export Yet</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload a school spreadsheet and run contact discovery before exporting.
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

  const previewRows = job.schools.slice(0, 15);
  const appendedCols = [
    'Contact Number',
    'Phone Number 2',
    'Mobile Number',
    'Email Address',
    'Source URL',
    'Confidence Score',
    'Verification Status',
  ];
  const originalPreviewHeaders =
    job.headers.length > 0
      ? [...job.headers, ...appendedCols.filter((c) => !job.headers.includes(c))]
      : STANDARD_HEADERS;

  const numbersFound = job.schools.filter(
    (s) => s.enriched.phone1 !== 'Not Found' || s.enriched.mobileNumber !== 'Not Found'
  ).length;
  const verifiedCount = job.schools.filter(
    (s) => s.enriched.verificationStatus === 'Verified'
  ).length;
  const emailsFound = job.schools.filter(
    (s) => s.enriched.emailAddress && s.enriched.emailAddress !== 'Not Found'
  ).length;
  const notFoundCount = Math.max(0, job.schools.length - numbersFound);

  const activeHeaders = exportFormat === 'original' ? originalPreviewHeaders : STANDARD_HEADERS;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Export Enriched School Data</h1>
            <p className="mt-1 text-sm text-slate-600">
              Preserves all{' '}
              <span className="font-mono tabular-nums font-semibold">{job.schools.length}</span>{' '}
              original rows and serial numbers. Verified contacts are highlighted in green,
              unverified contacts in yellow, and unavailable entries marked as{' '}
              <span className="font-mono text-xs">Not Found</span>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-emerald-100 border border-emerald-300 inline-block" />
                <span>Green cell: Verified Contact</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-amber-100 border border-amber-300 inline-block" />
                <span>Yellow cell: Unverified Contact</span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <a
              href={`/api/jobs/${job.id}/export/xlsx?format=${exportFormat}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Download Excel (.xlsx)</span>
            </a>
            <a
              href={`/api/jobs/${job.id}/export/csv?format=${exportFormat}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Download CSV (.csv)</span>
            </a>
          </div>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-200">
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-500">Numbers Found</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-emerald-700">
              {numbersFound} / {job.schools.length}
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-500">Verified Contacts</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-sky-700">
              {verifiedCount}
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-500">Emails Extracted</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900">
              {emailsFound}
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-500">Still Not Found</p>
            <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-600">
              {notFoundCount}
            </p>
          </div>
        </div>

        {/* Export Layout Selector */}
        <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-700">Export Column Layout</span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setExportFormat('original')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                exportFormat === 'original'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Original Columns + Contact &amp; Email
            </button>
            <button
              type="button"
              onClick={() => setExportFormat('standard')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                exportFormat === 'standard'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Standard 16-Column Format
            </button>
          </div>
        </div>
      </div>

      {/* Export Preview */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Export Preview ({activeHeaders.length} columns · Showing first {previewRows.length} rows)
          </h2>
          <span className="text-xs font-mono text-slate-500">{job.fileName}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-sky-600 text-white font-semibold">
                {activeHeaders.map((col) => (
                  <th key={col} className="px-3 py-2.5 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {previewRows.map((s) => {
                const vStatus = s.enriched.verificationStatus;
                const highlightClass =
                  vStatus === 'Verified'
                    ? 'bg-emerald-50 text-emerald-900 font-medium'
                    : vStatus === 'Unverified'
                      ? 'bg-amber-50 text-amber-900 font-medium'
                      : 'text-slate-400 italic';

                if (exportFormat === 'original') {
                  const rowMap: Record<string, string> = {
                    ...s.originalRow,
                    'Contact Number': s.enriched.phone1 || 'Not Found',
                    'Phone Number 2': s.enriched.phone2 || 'Not Found',
                    'Mobile Number': s.enriched.mobileNumber || 'Not Found',
                    'Email Address': s.enriched.emailAddress || 'Not Found',
                    'Source URL': s.enriched.sourceUrl || 'Not Found',
                    'Confidence Score':
                      s.enriched.confidenceScore > 0 ? `${s.enriched.confidenceScore}%` : '0%',
                    'Verification Status': s.enriched.verificationStatus || 'Not Found',
                  };

                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      {activeHeaders.map((col) => {
                        const val = rowMap[col] || '—';
                        const isHighlightCol = appendedCols.includes(col) && col !== 'Source URL' && col !== 'Confidence Score';
                        return (
                          <td
                            key={col}
                            className={`px-3 py-2 max-w-[220px] truncate ${
                              isHighlightCol && val !== 'Not Found'
                                ? `${highlightClass} font-mono tabular-nums`
                                : val === 'Not Found'
                                  ? 'text-slate-400 italic'
                                  : ''
                            }`}
                            title={val}
                          >
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }

                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap">{s.sNo}</td>
                    <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">
                      {s.schoolName}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap">
                      {s.affiliationNumber || 'Not Found'}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap">
                      {s.schoolCode || 'Not Found'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{s.district || 'Not Found'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{s.state || 'Not Found'}</td>
                    <td className="px-3 py-2 max-w-[220px] truncate" title={s.enriched.address}>
                      {s.enriched.address}
                    </td>
                    <td className="px-3 py-2 max-w-[180px] truncate">
                      {s.enriched.officialWebsite}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono tabular-nums whitespace-nowrap ${
                        s.enriched.phone1 !== 'Not Found' ? highlightClass : 'text-slate-400 italic'
                      }`}
                    >
                      {s.enriched.phone1}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono tabular-nums whitespace-nowrap ${
                        s.enriched.phone2 !== 'Not Found' ? highlightClass : 'text-slate-400 italic'
                      }`}
                    >
                      {s.enriched.phone2}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono tabular-nums whitespace-nowrap ${
                        s.enriched.mobileNumber !== 'Not Found'
                          ? highlightClass
                          : 'text-slate-400 italic'
                      }`}
                    >
                      {s.enriched.mobileNumber}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      {s.enriched.emailAddress}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono tabular-nums whitespace-nowrap ${
                        s.enriched.principalContact !== 'Not Found'
                          ? highlightClass
                          : 'text-slate-400 italic'
                      }`}
                    >
                      {s.enriched.principalContact}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={s.enriched.sourceUrl}>
                      {s.enriched.sourceUrl}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap">
                      {s.enriched.confidenceScore > 0 ? `${s.enriched.confidenceScore}%` : '0%'}
                    </td>
                    <td className={`px-3 py-2 whitespace-nowrap ${highlightClass}`}>
                      {s.enriched.verificationStatus}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
