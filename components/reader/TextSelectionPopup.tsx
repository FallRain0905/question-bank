'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface TextSelectionPopupProps {
  position: { x: number; y: number };
  text: string;
  onAction: (action: 'explain' | 'translate' | 'polish' | 'save') => void;
  onClose: () => void;
}

const actions = [
  { key: 'explain' as const, label: '解释', color: 'text-blue-600' },
  { key: 'translate' as const, label: '翻译', color: 'text-green-600' },
  { key: 'polish' as const, label: '润色', color: 'text-purple-600' },
  { key: 'save' as const, label: '存至草稿箱', color: 'text-amber-600' },
];

export default function TextSelectionPopup({ position, text, onAction, onClose }: TextSelectionPopupProps) {
  const adjustedX = Math.min(position.x - 120, (typeof window !== 'undefined' ? window.innerWidth - 280 : 800));
  const adjustedY = position.y > 80 ? position.y - 50 : position.y + 20;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        style={{ top: adjustedY, left: Math.max(8, adjustedX) }}
        className="fixed z-[60] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-gray-100">
          <p className="text-xs text-gray-500 line-clamp-1">{text}</p>
        </div>
        <div className="flex items-center divide-x divide-gray-100">
          {actions.map((a) => (
            <button
              key={a.key}
              onClick={() => onAction(a.key)}
              className={`px-3.5 py-2 text-xs font-medium ${a.color} hover:bg-gray-50 transition-colors whitespace-nowrap`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
