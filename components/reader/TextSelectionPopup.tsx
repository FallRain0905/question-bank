'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface TextSelectionPopupProps {
  position: { x: number; y: number };
  text: string;
  onAction: (action: 'explain' | 'translate' | 'ask' | 'summarize' | 'save') => void;
  onClose: () => void;
}
const actions = [
  { key: 'translate' as const, label: '翻译', color: 'text-green-600' },
  { key: 'explain' as const, label: '解释', color: 'text-blue-600' },
  { key: 'ask' as const, label: '追问', color: 'text-purple-600' },
  { key: 'summarize' as const, label: '总结', color: 'text-gray-700' },
  { key: 'save' as const, label: '保存', color: 'text-amber-600' },
];

export default function TextSelectionPopup({ position, text, onAction, onClose }: TextSelectionPopupProps) {
  const adjustedX = Math.min(position.x - 150, (typeof window !== 'undefined' ? window.innerWidth - 330 : 800));
  const adjustedY = position.y > 80 ? position.y - 50 : position.y + 20;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        style={{ top: adjustedY, left: Math.max(8, adjustedX) }}
        className="fixed z-[60] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
          <p className="line-clamp-1 text-xs text-gray-500">{text}</p>
          <button onClick={onClose} className="text-xs text-gray-300 hover:text-gray-500">x</button>
        </div>
        <div className="flex items-center divide-x divide-gray-100">
          {actions.map((a) => (
            <button
              key={a.key}
              onClick={() => onAction(a.key)}
              className={`whitespace-nowrap px-3 py-2 text-xs font-medium ${a.color} transition-colors hover:bg-gray-50`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
