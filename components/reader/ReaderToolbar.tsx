'use client';

interface ReaderToolbarProps {
  title: string;
  docId: string;
  readerTheme: 'light' | 'dark' | 'sepia';
  fontSize: number;
  readingMode: 'pdf' | 'markdown';
  canShowPdf: boolean;
  onThemeChange: (theme: 'light' | 'dark' | 'sepia') => void;
  onFontSizeChange: (size: number) => void;
  onReadingModeChange: (mode: 'pdf' | 'markdown') => void;
  onDownload: () => void;
  onBack: () => void;
}
export default function ReaderToolbar({
  title,
  docId,
  readerTheme,
  fontSize,
  readingMode,
  canShowPdf,
  onThemeChange,
  onFontSizeChange,
  onReadingModeChange,
  onDownload,
  onBack,
}: ReaderToolbarProps) {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-gray-100 bg-white/85 px-3 py-3 backdrop-blur-md sm:px-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onBack}
          className="touch-target flex shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
          aria-label="返回"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="truncate text-sm font-medium text-gray-900">{title}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto scrollbar-hide">
        {canShowPdf && (
          <div className="mr-1 flex shrink-0 rounded-lg bg-gray-100 p-0.5">
            <button
              onClick={() => onReadingModeChange('pdf')}
              className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                readingMode === 'pdf' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              PDF
            </button>
            <button
              onClick={() => onReadingModeChange('markdown')}
              className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                readingMode === 'markdown' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Markdown
            </button>
          </div>
        )}

        <button
          onClick={() => onFontSizeChange(Math.max(14, fontSize - 1))}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-xs font-bold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          A-
        </button>
        <button
          onClick={() => onFontSizeChange(Math.min(22, fontSize + 1))}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-xs font-bold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          A+
        </button>

        <div className="mx-1 h-4 w-px shrink-0 bg-gray-200" />

        {(['light', 'sepia', 'dark'] as const).map((theme) => (
          <button
            key={theme}
            onClick={() => onThemeChange(theme)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-xs transition-colors ${
              readerTheme === theme
                ? theme === 'sepia'
                  ? 'bg-amber-700 text-white'
                  : theme === 'dark'
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-900 text-white'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title={theme}
          >
            {theme === 'light' ? '日' : theme === 'sepia' ? '护' : '夜'}
          </button>
        ))}

        <div className="mx-1 h-4 w-px shrink-0 bg-gray-200" />

        <button
          onClick={onDownload}
          className="shrink-0 rounded border border-gray-200 px-2.5 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
        >
          下载
        </button>
        <a
          href={`/generator?doc=${docId}`}
          className="shrink-0 rounded bg-gray-900 px-2.5 py-2 text-xs text-white transition-colors hover:bg-gray-800"
        >
          出题
        </a>
      </div>
    </div>
  );
}
