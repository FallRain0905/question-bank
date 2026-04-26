'use client';

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function LoadingState({ message = '加载中...', size = 'md' }: LoadingStateProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className={`${sizeClasses[size]} animate-spin rounded-full border-4 border-gray-200 border-t-gray-500`} />
      <p className="mt-4 text-gray-400 text-sm">{message}</p>
    </div>
  );
}

export function LoadingOverlay({ message = '加载中...' }: { message?: string }) {
  return (
    <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-gray-900 rounded-2xl p-6 shadow-xl">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
        <p className="mt-4 text-gray-200 text-sm">{message}</p>
      </div>
    </div>
  );
}
