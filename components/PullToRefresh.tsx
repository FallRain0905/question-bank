'use client';

import { useState, useRef, TouchEvent } from 'react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  threshold?: number;
  className?: string;
}

export default function PullToRefresh({
  onRefresh,
  children,
  threshold = 80,
  className = '',
}: PullToRefreshProps) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1 && window.scrollY === 0) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (
      !touchStartRef.current ||
      e.touches.length !== 1 ||
      isRefreshing ||
      window.scrollY > 0
    )
      return;

    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartRef.current.y;

    // 只响应向下的滑动
    if (deltaY > 0) {
      const newDistance = Math.min(deltaY * 0.5, threshold * 1.5);
      setPullDistance(newDistance);
      setIsPulling(newDistance > threshold);
    }
  };

  const handleTouchEnd = async () => {
    if (isPulling && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setIsPulling(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
      setIsPulling(false);
    }
    touchStartRef.current = null;
  };

  // 刷新指示器高度
  const indicatorHeight = Math.max(0, pullDistance - 30);
  const opacity = Math.min(1, Math.max(0, pullDistance / threshold));
  const rotation = Math.min(180, (pullDistance / threshold) * 180);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`min-h-screen ${className}`}
    >
      {/* 刷新指示器 */}
      <div
        className="fixed top-0 left-0 right-0 flex justify-center items-end pointer-events-none z-50"
        style={{
          height: `${indicatorHeight}px`,
          opacity: isRefreshing ? 1 : opacity,
        }}
      >
        <div className="flex items-center gap-3 bg-gray-800/90 backdrop-blur-sm px-4 py-2 rounded-b-xl">
          <svg
            className={`w-6 h-6 text-gray-400 transition-transform duration-200 ${
              isRefreshing ? 'animate-spin' : ''
            }`}
            style={{ transform: `rotate(${isRefreshing ? 0 : rotation}deg)` }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span className="text-sm text-gray-300">
            {isRefreshing ? '刷新中...' : isPulling ? '释放刷新' : '下拉刷新'}
          </span>
        </div>
      </div>

      {/* 内容 */}
      <div
        className="transition-transform duration-300"
        style={{
          transform: `translateY(${isRefreshing ? 60 : 0}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
