'use client';

interface Paper {
  id: string;
  arxiv_id: string;
  title_en: string;
  title_zh: string | null;
  abstract_en: string | null;
  summary_zh: string | null;
  authors: string[];
  categories: string[];
  keywords: string[];
  pdf_url: string | null;
  arxiv_url: string | null;
  published_at: string;
  is_favorited?: boolean;
}

interface PaperCardProps {
  paper: Paper;
  onFavorite?: (paperId: string, favorited: boolean) => void;
  onImport?: (paper: Paper) => void;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);

  if (diffH < 1) return '刚刚';
  if (diffH < 24) return `${diffH}小时前`;
  if (diffD < 7) return `${diffD}天前`;
  return date.toLocaleDateString('zh-CN');
}

export default function PaperCard({ paper, onFavorite, onImport }: PaperCardProps) {
  let points: string[] = [];
  try {
    points = paper.summary_zh ? JSON.parse(paper.summary_zh) : [];
  } catch { /* ignore */ }

  const mainCategory = paper.categories[0] || 'cs.AI';

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-5 hover:border-blue-200 transition-colors">
      {/* Zone A: Source & Time */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 font-mono">ArXiv {mainCategory}</span>
        <span className="text-xs text-gray-400">{timeAgo(paper.published_at)}</span>
      </div>

      {/* Zone B: Title */}
      <h3 className="text-base sm:text-lg font-semibold text-slate-800 leading-snug mb-0.5">
        {paper.title_zh || paper.title_en}
      </h3>
      {paper.title_zh && (
        <p className="text-sm text-gray-400 leading-snug mb-3">{paper.title_en}</p>
      )}

      {/* Authors */}
      {paper.authors.length > 0 && (
        <p className="text-xs text-gray-400 mb-3">
          {paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ` et al.` : ''}
        </p>
      )}

      {/* Zone C: AI Summary */}
      {points.length > 0 && (
        <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 mb-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-xs font-medium text-blue-600">AI 总结</span>
          </div>
          <ul className="space-y-1">
            {points.map((point, idx) => (
              <li key={idx} className="text-sm text-slate-700 leading-relaxed flex gap-2">
                <span className="text-blue-400 shrink-0">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Zone D: Keywords & Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {paper.keywords.slice(0, 4).map(kw => (
            <span key={kw} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">
              {kw}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          {paper.arxiv_url && (
            <a
              href={paper.arxiv_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
            >
              原文
            </a>
          )}
          {onImport && (
            <button
              onClick={() => onImport(paper)}
              className="px-2.5 py-1 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
            >
              导入知识库
            </button>
          )}
          {onFavorite && (
            <button
              onClick={() => onFavorite(paper.id, !paper.is_favorited)}
              className={`text-lg leading-none transition-colors ${paper.is_favorited ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-400'}`}
            >
              {paper.is_favorited ? '★' : '☆'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { Paper };
