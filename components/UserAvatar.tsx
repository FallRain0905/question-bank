'use client';

import Link from 'next/link';

interface UserAvatarProps {
  userId?: string;
  username?: string;
  avatarUrl?: string | null;
  email?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showName?: boolean;
  showEmail?: boolean;
  subtitle?: string;
  className?: string;
}

export function UserAvatar({
  userId,
  username,
  avatarUrl,
  email,
  size = 'md',
  showName = true,
  showEmail = false,
  subtitle,
  className = '',
}: UserAvatarProps) {
  const displayName = username || '用户';
  const avatarSize = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
  };
  const textSize = {
    sm: 'text-sm',
    md: 'text-sm',
    lg: 'text-base',
    xl: 'text-lg',
  };

  const avatarContent = (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className={`${avatarSize[size]} rounded-full flex items-center justify-center font-medium transition-transform hover:scale-105 ${
          avatarUrl
            ? 'overflow-hidden'
            : 'bg-gradient-to-br from-gray-500 to-gray-600 text-gray-50 shadow-lg shadow-gray-500/20'
        }`}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <span>{displayName[0]?.toUpperCase() || '?'}</span>
        )}
      </div>

      {showName && (
        <div className="flex flex-col">
          <div className={`flex items-center gap-2 ${textSize[size]}`}>
            <span className="font-semibold text-gray-100">{displayName}</span>
          </div>
          {showEmail && email && (
            <span className="text-xs text-gray-400">{email}</span>
          )}
          {subtitle && (
            <span className="text-xs text-gray-400">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );

  if (userId) {
    return (
      <Link href={`/users/${userId}`} className="block transition-transform hover:scale-[1.02]">
        {avatarContent}
      </Link>
    );
  }

  return <div>{avatarContent}</div>;
}

// 简洁的用户标签（用于评论区）
export function UserTag({
  username,
  avatarUrl,
  email,
  className = '',
}: {
  username?: string;
  avatarUrl?: string | null;
  email?: string;
  className?: string;
}) {
  const displayName = username || '用户';

  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-1">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover ring-2 ring-gray-800/50 flex-shrink-0"
          />
        ) : (
          <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-full flex items-center justify-center text-gray-50 text-xs font-medium ring-2 ring-gray-800/50 flex-shrink-0">
            {displayName[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-gray-100 text-sm sm:text-base line-clamp-1">{displayName}</span>
        </div>
      </div>
    </div>
  );
}
