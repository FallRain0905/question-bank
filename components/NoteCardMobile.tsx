'use client';

import { getFileIcon, formatFileSize } from '@/lib/upload';
import type { NoteWithTags } from '@/types';

interface NoteCardMobileProps {
  note: NoteWithTags;
  isLiked: boolean;
  onLike: (noteId: string) => void;
}

export default function NoteCardMobile({ note, isLiked, onLike }: NoteCardMobileProps) {
  const handleLikeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onLike(note.id);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all duration-200">
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="text-2xl text-gray-600">
                {getFileIcon(note.file_name || '')}
              </div>
              <h3 className="font-semibold text-gray-900 text-base truncate">{note.title}</h3>
            </div>
            {note.file_name && (
              <p className="text-xs text-gray-500 truncate">{note.file_name}</p>
            )}
          </div>
        </div>

        {note.description && (
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">
            {note.description}
          </p>
        )}

        {note.tags && note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {note.tags.map((tag) => (
              <span
                key={tag.id}
                className="px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="truncate max-w-[120px]">{note.user_name || '匿名'}</span>
            {note.file_size && (
              <>
                <span className="text-gray-900/50">·</span>
                <span>{formatFileSize(note.file_size)}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLikeClick}
              className={`p-2 rounded-xl transition-all duration-200 ${
                isLiked
                  ? 'bg-red-50 text-red-500'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
              }`}
              aria-label={isLiked ? '取消点赞' : '点赞'}
            >
              <svg className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>

            {note.file_url && (
              <button
                onClick={() => window.open(note.file_url!, '_blank', 'noopener,noreferrer')}
                className="p-2.5 rounded-xl bg-blue-600 text-white transition-all duration-200 hover:bg-blue-700"
                aria-label="下载文件"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
