'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { uploadFile, isValidFileType, isValidFileSize, formatFileSize, MAX_FILE_SIZE } from '@/lib/upload';
import TagInput from '@/components/TagInput';
import type { ClassWithRole } from '@/types';

// 使用 MIME 类型 + 扩展名，确保移动端兼容性
const ACCEPTED_FILE_EXTENSIONS = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip', 'application/x-rar-compressed',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt',
  '.zip', '.rar'
].join(',');

export default function NoteUploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');

  // 班级选择和可见性
  const [classes, setClasses] = useState<ClassWithRole[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [visibility, setVisibility] = useState<'class' | 'public'>('class');
  const [user, setUser] = useState<any>(null);

  // 使用 ref 防止组件卸载后更新状态
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    checkUser();
    return () => {
      isMounted.current = false;
    };
  }, []);

  const checkUser = async () => {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }
    if (!isMounted.current) return;

    setUser(user);

    // 获取所有标签
    try {
      const { data: tagsData } = await supabase.from('tags').select('name');
      if (isMounted.current) {
        setAvailableTags(tagsData?.map((t: any) => t.name) || []);
      }
    } catch (err) {
      console.error('获取标签失败:', err);
    }

    // 获取用户的班级
    try {
      const { data: classesData } = await supabase
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
        .eq('user_id', user.id)
        .eq('status', 'approved');

      if (isMounted.current) {
        setClasses(classesData?.map((c: any) => ({
          ...c.classes,
          userRole: c.role,
        })) || []);
      }
    } catch (err) {
      console.error('获取班级失败:', err);
      if (isMounted.current) {
        setClasses([]);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    setFileError('');

    if (!selectedFile) {
      setFile(null);
      return;
    }

    if (!isValidFileType(selectedFile)) {
      setFileError('不支持的文件类型，请上传图片、PDF、Word、PPT 或 Excel 文件');
      setFile(null);
      return;
    }

    if (!isValidFileSize(selectedFile)) {
      setFileError(`文件大小不能超过 ${formatFileSize(MAX_FILE_SIZE)}`);
      setFile(null);
      return;
    }

    setFile(selectedFile);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFileError('');

    if (!title.trim()) {
      setError('请输入标题');
      return;
    }

    if (!file) {
      setFileError('请选择要上传的文件');
      return;
    }

    if (tags.length === 0) {
      setError('请至少添加一个标签');
      return;
    }

    if (visibility === 'class' && !selectedClassId) {
      setError('请选择一个班级');
      return;
    }

    setUploading(true);

    try {
      const supabase = getSupabase();

      // 上传文件
      const uploadResult = await uploadFile(file, 'files', 'notes');
      const fileUrl = uploadResult.url;
      const fileName = file.name;
      const fileType = file.type;
      const fileSize = file.size;

      // 插入笔记记录
      const insertData: any = {
        user_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        file_url: fileUrl,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        status: 'pending',
        visibility: visibility,
      };

      // 仅当选择班级可见时添加 class_id
      if (visibility === 'class' && selectedClassId) {
        insertData.class_id = selectedClassId;
      }

      const { data: noteData, error: insertError } = await supabase
        .from('notes')
        .insert(insertData)
        .select('id')
        .single();

      if (insertError) throw insertError;

      const noteId = noteData.id;

      // 处理标签
      for (const tagName of tags) {
        let tagId;
        const { data: existingTag } = await supabase
          .from('tags')
          .select('id')
          .eq('name', tagName)
          .maybeSingle();

        if (existingTag) {
          tagId = existingTag.id;
        } else {
          const { data: newTag } = await supabase
            .from('tags')
            .insert({ name: tagName })
            .select('id')
            .single();
          tagId = newTag?.id;
        }

        if (tagId && noteId) {
          await supabase
            .from('note_tags')
            .insert({ note_id: noteId, tag_id: tagId });
        }
      }

      alert('笔记上传成功！等待管理员或班级审核员审核后即可在笔记库中查看。');

      // 重置表单
      setTitle('');
      setDescription('');
      setTags([]);
      setFile(null);
      setSelectedClassId('');
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (err: any) {
      console.error('上传失败:', err);
      setError(err.message || '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] theme-bg-gradient">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">上传笔记</h1>
          <p className="text-gray-600 mt-1">分享你的学习笔记，帮助更多同学</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
          {/* 提醒信息 */}
          <div className="bg-gray-200/30 border border-gray-100 px-4 py-3 rounded-lg">
            <p className="text-sm text-gray-700">
              ⚠️ <strong>请遵守社区规范：</strong>禁止上传违法违规、色情暴力、广告刷屏等内容。所有内容需经审核后显示，违规账号将被封禁。
            </p>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800/50 text-red-300 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* 班级选择 - 仅当选择班级可见时显示 */}
          {visibility === 'class' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                选择班级 <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none text-gray-800"
                disabled={uploading}
              >
                <option value="">请选择班级</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                    {cls.userRole === 'creator' && ' (管理员)'}
                  </option>
                ))}
              </select>
              {classes.length === 0 && (
                <p className="mt-1 text-sm text-gray-9000">
                  还没有加入班级，请先 <a href="/classes" className="text-gray-700 hover:text-gray-800">创建或加入班级</a>
                </p>
              )}
            </div>
          )}

          {/* 可见性选择 */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              可见范围
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="radio"
                  name="visibility"
                  value="class"
                  checked={visibility === 'class'}
                  onChange={(e) => setVisibility(e.target.value as 'class' | 'public')}
                  disabled={uploading}
                  className="mt-1 w-4 h-4 text-gray-9000 bg-gray-50 border-gray-200 rounded focus:ring-gray-500"
                />
                <div>
                  <span className="text-gray-800 group-hover:text-gray-900 transition-colors">
                    <strong>仅本班级可见</strong>
                  </span>
                  <p className="text-sm text-gray-9000 mt-1">只有该班级的成员可以看到此笔记</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={(e) => setVisibility(e.target.value as 'class' | 'public')}
                  disabled={uploading}
                  className="mt-1 w-4 h-4 text-gray-9000 bg-gray-50 border-gray-200 rounded focus:ring-gray-500"
                />
                <div>
                  <span className="text-gray-800 group-hover:text-gray-900 transition-colors">
                    <strong>全部可见</strong>
                  </span>
                  <p className="text-sm text-gray-9000 mt-1">所有用户都可以看到此笔记</p>
                </div>
              </label>
            </div>
          </div>

          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              标题 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="给笔记起个名字吧"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none text-gray-800 placeholder-gray-500"
              disabled={uploading}
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单介绍一下笔记的内容..."
              rows={3}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none resize-none text-gray-800 placeholder-gray-500"
              disabled={uploading}
            />
          </div>

          {/* 文件上传 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              文件 <span className="text-red-400">*</span>
            </label>
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-gray-300 transition-colors bg-gray-50/30">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_EXTENSIONS}
                onChange={handleFileChange}
                className="hidden"
                disabled={uploading}
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer"
              >
                {file ? (
                  <div className="space-y-2">
                    <div className="text-4xl">📄</div>
                    <p className="font-medium text-gray-800">{file.name}</p>
                    <p className="text-sm text-gray-9000">{formatFileSize(file.size)}</p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      移除文件
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-4xl">📁</div>
                    <p className="text-gray-9000">点击选择文件</p>
                    <p className="text-xs text-gray-9000">
                      支持图片、PDF、Word、PPT、Excel 等格式
                    </p>
                    <p className="text-xs text-gray-9000">
                      最大文件大小 {formatFileSize(MAX_FILE_SIZE)}
                    </p>
                  </div>
                )}
              </label>
            </div>
            {fileError && (
              <p className="mt-2 text-sm text-red-400">{fileError}</p>
            )}
          </div>

          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              标签 <span className="text-red-400">*</span>
            </label>
            <TagInput
              tags={tags}
              onChange={setTags}
              availableTags={availableTags}
              placeholder="添加标签（如：高等数学、力学、复习笔记）"
            />
          </div>

          {/* 提交按钮 */}
          <div className="pt-4">
            <button
              type="submit"
              disabled={uploading || (visibility === 'class' && !selectedClassId)}
              className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition disabled:bg-white disabled:cursor-not-allowed disabled:text-gray-9000"
            >
              {uploading ? '上传中...' : '上传笔记'}
            </button>
          </div>
        </form>

        {/* 提示信息 */}
        <div className="mt-6 bg-white/30 border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-700">
            <strong>提示：</strong>上传的笔记需要经过管理员或班级审核员审核后才能在笔记库中显示。
            {visibility === 'class' && ' 只有该班级的成员可以看到此笔记。'}
          </p>
        </div>
      </div>
    </div>
  );
}
