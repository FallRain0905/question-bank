'use client';

import { useState, useEffect } from 'react';

interface Action {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  destructive?: boolean;
}

interface MobileActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  actions: Action[];
}

export default function MobileActionSheet({
  isOpen,
  onClose,
  title,
  actions,
}: MobileActionSheetProps) {
  // 阻止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // 处理点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (e.target instanceof HTMLElement && !e.target.closest('.action-sheet-content')) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 底部面板 */}
      <div className="action-sheet-content absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl shadow-2xl border-t border-gray-700 transition-transform duration-300">
        {/* 拖动指示器 */}
        <div className="flex justify-center py-3">
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        {/* 标题 */}
        {title && (
          <div className="px-6 pb-3 border-b border-gray-800">
            <h3 className="text-lg font-medium text-gray-50">{title}</h3>
          </div>
        )}

        {/* 操作列表 */}
        <div className="px-2 py-2 sm:hidden">
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => {
                action.onClick();
                onClose();
              }}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition ${
                action.destructive
                  ? 'text-red-400 hover:bg-red-900/20'
                  : 'text-gray-200 hover:bg-gray-800'
              }`}
            >
              {action.icon && (
                <span className="text-xl w-8 text-center">{action.icon}</span>
              )}
              <span className="flex-1 text-left text-base">{action.label}</span>
            </button>
          ))}

          {/* 取消按钮 */}
          <button
            onClick={onClose}
            className="w-full mt-2 px-4 py-3.5 rounded-xl text-gray-400 hover:bg-gray-800 transition"
          >
            <span className="text-base">取消</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook 用于管理 ActionSheet
export function useActionSheet() {
  const [isOpen, setIsOpen] = useState(false);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
