'use client';

interface ReaderToolbarProps {
  title: string;
  docId: string;
  readerTheme: 'light' | 'dark' | 'sepia';
  fontSize: number;
  onThemeChange: (theme: 'light' | 'dark' | 'sepia') => void;
  onFontSizeChange: (size: number) => void;
  onDownload: () => void;
  onBack: () => void;
}

export default function ReaderToolbar({
  title, docId, readerTheme, fontSize, onThemeChange, onFontSizeChange, onDownload, onBack,
}: ReaderToolbarProps) {
  return (
    <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-100 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-sm font-medium text-gray-900 truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {/* 字体大小 */}
        <button
          onClick={() => onFontSizeChange(Math.max(14, fontSize - 1))}
          className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors text-xs font-bold"
        >A-</button>
        <button
          onClick={() => onFontSizeChange(Math.min(22, fontSize + 1))}
          className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors text-xs font-bold"
        >A+</button>

        <div className="w-px h-4 bg-gray-200 mx-1" />

        {/* 主题切换 */}
        <button
          onClick={() => onThemeChange('light')}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${readerTheme === 'light' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
          title="日间"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
        <button
          onClick={() => onThemeChange('sepia')}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${readerTheme === 'sepia' ? 'bg-amber-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
          title="护眼"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M12 3C6.95 3 3 7.95 3 12s3.95 9 9 9 9-4.95 9-9-4.05-9-9-9z" /><circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button
          onClick={() => onThemeChange('dark')}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${readerTheme === 'dark' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
          title="夜间"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        </button>

        <div className="w-px h-4 bg-gray-200 mx-1" />

        <button onClick={onDownload} className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors">
          下载
        </button>
        <a href={`/generator?doc=${docId}`} className="px-2.5 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors">
          出题
        </a>
      </div>
    </div>
  );
}
