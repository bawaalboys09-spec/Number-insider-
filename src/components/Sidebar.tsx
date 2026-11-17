import {
  FileSpreadsheet,
  FileUp,
  History,
  LayoutDashboard,
  SearchCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';

export type NavPage =
  | 'dashboard'
  | 'upload'
  | 'results'
  | 'history'
  | 'export'
  | 'settings';

interface SidebarProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  activeJobName?: string;
  activeJobProgress?: string;
}

const NAV_ITEMS: Array<{ id: NavPage; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'upload', label: 'Upload Excel', icon: FileUp },
  { id: 'results', label: 'Search Results', icon: SearchCheck },
  { id: 'history', label: 'Processing History', icon: History },
  { id: 'export', label: 'Export Excel', icon: FileSpreadsheet },
  { id: 'settings', label: 'API Settings', icon: SlidersHorizontal },
];

export function Sidebar({
  activePage,
  onNavigate,
  mobileOpen,
  onCloseMobile,
  activeJobName,
  activeJobProgress,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col justify-between bg-white border-r border-slate-200">
      <div>
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
          <div className="min-w-0">
            <span className="block text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
              School Contact Finder AI
            </span>
            <span className="block mt-0.5 text-xs text-slate-500">
              Excel Data Enrichment
            </span>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="px-3 py-4 space-y-1" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-sky-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-200">
        {activeJobName ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Active Workbook</p>
            <p className="text-sm font-semibold text-slate-900 truncate" title={activeJobName}>
              {activeJobName}
            </p>
            {activeJobProgress && (
              <p className="text-xs font-mono tabular-nums text-sky-700">{activeJobProgress}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500 leading-relaxed">
            Upload Excel. Find School Numbers. Export Complete Data.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">{navContent}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/30"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10">{navContent}</aside>
        </div>
      )}
    </>
  );
}
