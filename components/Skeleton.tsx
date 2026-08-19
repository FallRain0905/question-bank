'use client';

/**
 * 可复用的骨架屏原语。新页面加载态统一使用这些组件，
 * 避免各处手写 `animate-pulse` 结构，保持视觉一致。
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

/** 通用卡片骨架：适合列表页占位。 */
export function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white border border-gray-100 rounded-xl p-4 sm:p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-14" />
      </div>
      <Skeleton className="h-5 w-3/4 mb-2" />
      <Skeleton className="h-4 w-1/2 mb-4" />
      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    </div>
  );
}

/** 论文卡片骨架：与 PaperCard 的布局对齐。 */
export function PaperCardSkeleton() {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-5 w-3/4 mb-2" />
      <Skeleton className="h-4 w-1/2 mb-3" />
      <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 mb-3 space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
    </div>
  );
}

/** 列表页骨架：渲染 N 个卡片占位。 */
export function ListSkeleton({ count = 3, component }: { count?: number; component?: 'card' | 'paper' }) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <div className="space-y-4">
      {items.map(i => (component === 'paper' ? <PaperCardSkeleton key={i} /> : <CardSkeleton key={i} />))}
    </div>
  );
}
