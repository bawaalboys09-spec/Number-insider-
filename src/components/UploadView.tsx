import { useState, type ChangeEvent, type DragEvent } from 'react';
import { CheckCircle2, FileSpreadsheet, Play, UploadCloud } from 'lucide-react';
import type { ColumnMapping, ParsedUploadPreview } from '../types/school.ts';

interface UploadViewProps {
  onBatchCreated: (jobId: string) => void;
}

const MAPPING_FIELDS: Array<{ key: keyof ColumnMapping; label: string; required?: boolean }> = [
  { key: 'schoolName', label: 'School Name', required: true },
  { key: 'principalName', label: 'Principal Name' },
  { key: 'district', label: 'District' },
  { key: 'state', label: 'State' },
  { key: 'address', label: 'Address' },
  { key: 'website', label: 'Website' },
  { key: 'cbseDetailsUrl', label: 'CBSE Details URL' },
  { key: 'affiliationNumber', label: 'Affiliation No.' },
  { key: 'schoolCode', label: 'School Code' },
  { key: 'serialNo', label: 'S.No.' },
  { key: 'existingPhone', label: 'Existing Phone (Optional)' },
  { key: 'existingEmail', label: 'Existing Email (Optional)' },
];

const SAMPLE_BIHAR_CSV = `S.No.,Affiliation No.,School Code,State,District,School Name,Principal Name,Address,Website,CBSE Details URL
1,330059,65055,Bihar,Patna,Delhi Public School Patna,,Village Chandmari PS Shahpur Danapur Cantonment Patna,https://www.dpspatna.com,https://saras.cbse.gov.in/SARAS/AffiliatedList/AfflicationDetails/330059
2,330006,65004,Bihar,Patna,Notre Dame Academy Patna,,Patliputra Colony Patna,https://notredameacademypatna.in,https://saras.cbse.gov.in/SARAS/AffiliatedList/AfflicationDetails/330006
3,330016,65011,Bihar,Patna,St. Michael's High School Patna,,Digha Ghat Patna,https://www.stmichaelspatna.edu.in,https://saras.cbse.gov.in/SARAS/AffiliatedList/AfflicationDetails/330016
4,330001,65001,Bihar,Patna,PM SHRI Kendriya Vidyalaya Danapur Cantt,,Danapur Cantt Patna Bihar,https://danapurcantt.kvs.ac.in,https://saras.cbse.gov.in/SARAS/AffiliatedList/AfflicationDetails/300001
5,330002,65002,Bihar,Gaya,PM SHRI Kendriya Vidyalaya No. 1 Gaya,,Rajendra Memorial Building Bageshwari Road Gaya Bihar,https://no1gaya.kvs.ac.in,https://saras.cbse.gov.in/SARAS/AffiliatedList/AfflicationDetails/300002`;

export function UploadView({ onBatchCreated }: UploadViewProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedUploadPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    serialNo: '',
    schoolName: '',
    affiliationNumber: '',
    schoolCode: '',
    principalName: '',
    district: '',
    state: '',
    address: '',
    website: '',
    cbseDetailsUrl: '',
    existingPhone: '',
    existingEmail: '',
  });

  const handleFileUpload = async (file: File, sheetName?: string) => {
    setError(null);
    setIsUploading(true);
    setUploadedFile(file);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const url = sheetName
        ? `/api/upload?sheet=${encodeURIComponent(sheetName)}`
        : '/api/upload';
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse spreadsheet');
      }
      const parsed = data as ParsedUploadPreview;
      setPreview(parsed);
      setMapping(parsed.detectedMapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFileUpload(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileUpload(file);
  };

  const handleLoadSample = async () => {
    const blob = new Blob([SAMPLE_BIHAR_CSV], { type: 'text/csv' });
    const file = new File([blob], 'bihar_schools_sample.csv', { type: 'text/csv' });
    await handleFileUpload(file);
  };

  const handleCreateBatch = async (autoStart = false) => {
    if (!preview) return;
    if (!mapping.schoolName) {
      setError('Please map the required School Name column before continuing.');
      return;
    }

    setError(null);
    setIsCreating(true);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: preview.fileName,
          headers: preview.headers,
          rawRows: preview.rawRows,
          columnMapping: mapping,
          autoStart,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create enrichment batch');
      }
      onBatchCreated(data.job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create batch');
    } finally {
      setIsCreating(false);
    }
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Upload School Excel or CSV</h1>
            <p className="mt-1 text-sm text-slate-600">
              Supports any <span className="font-mono text-xs">.xlsx</span>,{' '}
              <span className="font-mono text-xs">.xls</span>, or{' '}
              <span className="font-mono text-xs">.csv</span> layout — multi-sheet workbooks and
              sheets with title rows are auto-detected.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLoadSample}
            disabled={isUploading}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Load Sample Bihar Schools (5 Rows)</span>
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mt-6 border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            isDragging
              ? 'border-sky-500 bg-sky-50/50'
              : 'border-slate-300 bg-slate-50/40 hover:border-sky-400'
          }`}
        >
          <UploadCloud className="w-10 h-10 text-sky-600 mx-auto" />
          <p className="mt-3 text-sm font-semibold text-slate-900">
            {isUploading
              ? 'Parsing spreadsheet...'
              : 'Drag and drop your school spreadsheet here, or browse'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Maximum file size 15 MB · All original serial numbers and columns preserved
          </p>
          <label className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 cursor-pointer transition-colors">
            <span>Select Excel / CSV File</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileInput}
              className="sr-only"
            />
          </label>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">
            {error}
          </div>
        )}
      </div>

      {preview && (
        <>
          {/* Column Mapping */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Parsed {preview.rowCount} school records from {preview.fileName}
                  </span>
                  <span className="text-slate-400 font-normal">·</span>
                  <span className="text-slate-600 font-normal">
                    Header row {preview.detectedHeaderRow || 1} · {mappedCount} columns mapped
                  </span>
                </div>
                <h2 className="mt-1 text-base font-bold text-slate-900">
                  Verify Column Mapping
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {preview.sheetNames && preview.sheetNames.length > 1 && uploadedFile && (
                  <select
                    value={preview.selectedSheet || ''}
                    onChange={(e) => void handleFileUpload(uploadedFile, e.target.value)}
                    disabled={isUploading}
                    aria-label="Select worksheet"
                    className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    {preview.sheetNames.map((s) => (
                      <option key={s} value={s}>
                        Sheet: {s}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={() => void handleCreateBatch(false)}
                  disabled={isCreating || !mapping.schoolName}
                  className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  Load into Dashboard
                </button>

                <button
                  type="button"
                  onClick={() => void handleCreateBatch(true)}
                  disabled={isCreating || !mapping.schoolName}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4" />
                  <span>
                    {isCreating ? 'Starting...' : `Upload & Start Search (${preview.rowCount})`}
                  </span>
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {MAPPING_FIELDS.map((field) => (
                <div key={field.key}>
                  <label
                    htmlFor={`map-${field.key}`}
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    {field.label}
                    {field.required && <span className="text-rose-600 ml-0.5">*</span>}
                  </label>
                  <select
                    id={`map-${field.key}`}
                    value={mapping[field.key] || ''}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">-- Not Mapped --</option>
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview Rows */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Data Preview (First {preview.sampleRows.length} of {preview.rowCount} rows)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {preview.headers.map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {preview.sampleRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60">
                      {preview.headers.map((h) => (
                        <td
                          key={h}
                          className="px-4 py-2.5 text-slate-700 max-w-xs truncate"
                          title={row[h]}
                        >
                          {row[h] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
