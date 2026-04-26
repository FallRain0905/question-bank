'use client';

import Link from 'next/link';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    href: string;
  };
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-6xl mb-4">{icon}</div>
      <h3 className="text-lg font-medium text-gray-100 mb-2">{title}</h3>
      {description && (
        <p className="text-gray-400 text-sm max-w-md mb-6">{description}</p>
      )}
      {action && (
        <Link
          href={action.href}
          className="px-6 py-3 bg-gray-500 text-gray-50 rounded-full hover:bg-gray-400 transition-colors text-sm font-medium"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function EmptyStateCompact({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-8">
      <p className="text-gray-400">{title}</p>
      {description && (
        <p className="text-gray-500 text-sm mt-1">{description}</p>
      )}
    </div>
  );
}
