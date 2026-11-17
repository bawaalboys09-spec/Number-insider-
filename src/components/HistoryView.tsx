import { Download, FolderOpen, Trash2 } from 'lucide-react';
import type { BatchJobSummary } from '../types/school.ts';

interface HistoryViewProps {
  jobs: BatchJobSummary[];
  activeJobId?: string;
  onSelectJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  onNavigateUpload: () => void;
}

export function HistoryView({
  jobs,
  activeJobId,
  onSelectJob,
  onDeleteJob,
  onNavigateUpload,
}: HistoryViewProps) {
  if (jobs.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h2 className="text-lg font-bold text-slate-900">No Processing History Yet</h2>
        <p className="mt-1 text-sm text-slate-600">
          Every uploaded spreadsheet batch and enrichment run is saved here for resume or export.
        </p>
        <button
          type="button"
          onClick={onNavigateUpload}
          className="mt-5 px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700"
        >
          Upload First Spreadsheet
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200">
        <h1 className="text-lg font-bold text-slate-900">Processing History</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Reload previous Excel enrichment batches, resume paused runs, or download exports.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <th className="px-5 py-3">Workbook File</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Schools</th>
              <th className="px-5 py-3 text-right">Found</th>
              <th className="px-5 py-3 text-right">Verified</th>
              <th className="px-5 py-3">Updated</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {jobs.map((item) => {
              const isCurrent = item.id === activeJobId;
              return (
                <tr key={item.id} className={isCurrent ? 'bg-sky-50/50' : 'hover:bg-slate-50'}>
                  <td className="px-5 py-3.5 font-medium text-slate-900">
                    {item.fileName}
                    {isCurrent && (
                      <span className="ml-2 text-xs font-semibold text-sky-700">· Active</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 capitalize text-slate-700">{item.status}</td>
                  <td className="px-5 py-3.5 text-right font-mono tabular-nums text-slate-700">
                    {item.stats.totalSchools}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono tabular-nums text-slate-700">
                    {item.stats.numbersFound}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono tabular-nums text-emerald-700 font-medium">
                    {item.stats.verifiedNumbers}
                  </td>
                  <td className="px-5 py-3.5 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {new Date(item.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap space-x-2">
                    <button
                      type="button"
                      onClick={() => onSelectJob(item.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-md hover:bg-sky-100"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Open</span>
                    </button>
                    <a
                      href={`/api/jobs/${item.id}/export/xlsx`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>.xlsx</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => onDeleteJob(item.id)}
                      className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-rose-700 bg-white border border-rose-200 rounded-md hover:bg-rose-50"
                      aria-label={`Delete ${item.fileName}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
