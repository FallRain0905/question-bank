'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { ClassWithRole } from '@/types';

export function useClassMembership(userId?: string) {
  const [classes, setClasses] = useState<ClassWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    if (userId) {
      loadClasses(userId);
    }

    return () => {
      isMounted.current = false;
    };
  }, [userId]);

  const loadClasses = useCallback(async (uid: string) => {
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();
      const { data, error: fetchError } = await supabase
        .from('class_members')
        .select(`
          class_id,
          role,
          status,
          classes (
            id,
            name
          )
        `)
        .eq('user_id', uid)
        .eq('status', 'approved');

      if (fetchError) throw fetchError;

      if (isMounted.current) {
        setClasses(
          data?.map((c: any) => ({
            ...c.classes,
            userRole: c.role,
          })) || []
        );
      }
    } catch (err) {
      console.error('获取团队失败:', err);
      if (isMounted.current) {
        setError('获取团队失败');
        setClasses([]);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, []);

  return {
    classes,
    loading,
    error,
    reload: userId ? () => loadClasses(userId) : undefined,
  };
}

/**
 * 检查用户是否是管理员或团队审核员
 */
export async function checkAdminOrModerator(userId: string): Promise<{
  isAdmin: boolean;
  isClassModerator: boolean;
  moderatingClasses: { id: string; name: string; role: string }[];
}> {
  const supabase = getSupabase();
  
  // 检查是否是管理员
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = user?.user_metadata?.is_admin === true;

  if (isAdmin) {
    return { isAdmin: true, isClassModerator: false, moderatingClasses: [] };
  }

  // 检查是否是团队创建者或审核员
  const { data: classMembers } = await supabase
    .from('class_members')
    .select(`
      class_id,
      role,
      classes (
        id,
        name
      )
    `)
    .eq('user_id', userId)
    .in('role', ['creator', 'moderator']);

  const moderatingClasses = (classMembers || []).map((c: any) => ({
    id: c.classes.id,
    name: c.classes.name,
    role: c.role,
  }));

  return {
    isAdmin: false,
    isClassModerator: moderatingClasses.length > 0,
    moderatingClasses,
  };
}
