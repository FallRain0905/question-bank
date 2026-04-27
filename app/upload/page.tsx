'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/utils';
import { uploadFile, isValidFileType, isValidFileSize, formatFileSize, MAX_FILE_SIZE } from '@/lib/upload';
import TagInput from '@/components/TagInput';
import type { ClassWithRole } from '@/types';

interface QuestionImage {
  file: File;
  preview: string;
}

export default function UploadPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 使用 ref 防止组件卸载后更新状态
  const isMounted = useRef(true);

  // 上传类型
  const [uploadType, setUploadType] = useState<'text' | 'image' | 'file'>('text');

  // 文本模式相关
  const [questionText, setQuestionText] = useState('');
  const [answerText, setAnswerText] = useState('');

  // 图片模式相关
  const [questionImage, setQuestionImage] = useState<QuestionImage | null>(null);
  const [answerImage, setAnswerImage] = useState<QuestionImage | null>(null);
  const questionImageInputRef = useRef<HTMLInputElement>(null);
  const answerImageInputRef = useRef<HTMLInputElement>(null);

  // 文件模式相关
  const [questionFile, setQuestionFile] = useState<File | null>(null);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const questionFileInputRef = useRef<HTMLInputElement>(null);
  const answerFileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');

  // 标签
  const [tags, setTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  // 团队选择和可见性
  const [classes, setClasses] = useState<ClassWithRole[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [visibility, setVisibility] = useState<'class' | 'public'>('class');

  // 文件上传的 MIME 类型
  const ACCEPTED_FILE_TYPES = [
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

  useEffect(() => {
    isMounted.current = true;

    const checkAuth = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      if (!isMounted.current) return;

      setUser({ id: user.id, email: user.email || '' });

      const supabase = getSupabase();

      // 获取所有标签
      try {
        const { data: tagsData } = await supabase.from('tags').select('name');
        if (isMounted.current) {
          setAvailableTags(tagsData?.map((t: any) => t.name) || []);
        }
      } catch (err) {
        console.error('获取标签失败:', err);
      }

      // 获取用户的团队
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
        console.error('获取团队失败:', err);
        if (isMounted.current) {
          setClasses([]);
        }
      }

      if (isMounted.current) {
        setLoading(false);
      }
    };

    checkAuth();

    return () => {
      isMounted.current = false;
    };
  }, [router]);

  const handleImageSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'question' | 'answer'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('图片大小不能超过 5MB');
      return;
    }

    setError('');

    const reader = new FileReader();
    reader.onloadend = () => {
      const imageData = {
        file,
        preview: reader.result as string
      };

      if (type === 'question') {
        setQuestionImage(imageData);
      } else {
        setAnswerImage(imageData);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'question' | 'answer'
  ) => {
    const file = e.target.files?.[0];
    setFileError('');

    if (!file) {
      if (type === 'question') setQuestionFile(null);
      else setAnswerFile(null);
      return;
    }

    if (!isValidFileType(file)) {
      setFileError('不支持的文件类型，请上传图片、PDF、Word、PPT 或 Excel 文件');
      return;
    }

    if (!isValidFileSize(file)) {
      setFileError(`文件大小不能超过 ${formatFileSize(MAX_FILE_SIZE)}`);
      return;
    }

    if (type === 'question') setQuestionFile(file);
    else setAnswerFile(file);
  };

  const removeImage = (type: 'question' | 'answer') => {
    if (type === 'question') {
      setQuestionImage(null);
      questionImageInputRef.current?.value && (questionImageInputRef.current.value = '');
    } else {
      setAnswerImage(null);
      answerImageInputRef.current?.value && (answerImageInputRef.current.value = '');
    }
  };

  const removeFile = (type: 'question' | 'answer') => {
    if (type === 'question') {
      setQuestionFile(null);
      questionFileInputRef.current?.value && (questionFileInputRef.current.value = '');
    } else {
      setAnswerFile(null);
      answerFileInputRef.current?.value && (answerFileInputRef.current.value = '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFileError('');

    // 验证团队（仅当选择团队可见时）
    if (visibility === 'class' && !selectedClassId) {
      setError('请选择一个团队');
      return;
    }

    // 验证标签
    if (tags.length === 0) {
      setError('请至少添加一个标签');
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabase();
      let questionTextValue: string | null = null;
      let questionImageUrl: string | null = null;
      let questionFileUrl: string | null = null;
      let questionFileName: string | null = null;
      let questionFileType: string | null = null;
      let questionFileSize: number | null = null;

      let answerTextValue: string | null = null;
      let answerImageUrl: string | null = null;
      let answerFileUrl: string | null = null;
      let answerFileName: string | null = null;
      let answerFileType: string | null = null;
      let answerFileSize: number | null = null;

      // 根据上传类型处理
      if (uploadType === 'text') {
        if (!questionText.trim() && !answerText.trim()) {
          setError('请输入题目或答案内容');
          setLoading(false);
          return;
        }
        questionTextValue = questionText.trim() || null;
        answerTextValue = answerText.trim() || null;
      } else if (uploadType === 'image') {
        if (!questionImage && !answerImage) {
          setError('请至少上传题目或答案图片');
          setLoading(false);
          return;
        }

        if (questionImage) {
          questionImageUrl = await uploadImage(questionImage.file, user!.id);
        }

        if (answerImage) {
          answerImageUrl = await uploadImage(answerImage.file, user!.id);
        }
      } else if (uploadType === 'file') {
        if (!questionFile && !answerFile) {
          setError('请至少上传题目或答案文件');
          setLoading(false);
          return;
        }

        if (questionFile) {
          const result = await uploadFile(questionFile, 'files', 'questions');
          questionFileUrl = result.url;
          questionFileName = questionFile.name;
          questionFileType = questionFile.type;
          questionFileSize = questionFile.size;
        }

        if (answerFile) {
          const result = await uploadFile(answerFile, 'files', 'questions');
          answerFileUrl = result.url;
          answerFileName = answerFile.name;
          answerFileType = answerFile.type;
          answerFileSize = answerFile.size;
        }
      }

      // 创建题目记录
      const insertData: any = {
        user_id: user!.id,
        question_text: questionTextValue,
        question_image_url: questionImageUrl,
        question_file_url: questionFileUrl,
        question_file_name: questionFileName,
        question_file_type: questionFileType,
        question_file_size: questionFileSize,
        answer_text: answerTextValue,
        answer_image_url: answerImageUrl,
        answer_file_url: answerFileUrl,
        answer_file_name: answerFileName,
        answer_file_type: answerFileType,
        answer_file_size: answerFileSize,
        status: 'pending',
        visibility: visibility,
      };

      // 仅当选择团队可见时添加 class_id
      if (visibility === 'class' && selectedClassId) {
        insertData.class_id = selectedClassId;
      }

      const { data: question, error: insertError } = await supabase
        .from('questions')
        .insert(insertData)
        .select('id')
        .single();

      if (insertError) throw insertError;

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

        if (tagId && question?.id) {
          await supabase
            .from('question_tags')
            .insert({ question_id: question.id, tag_id: tagId });
        }
      }

      alert('题目上传成功！等待管理员或团队审核员审核后即可在题库中查看。');

      // 重置表单
      setQuestionText('');
      setAnswerText('');
      setQuestionImage(null);
      setAnswerImage(null);
      setQuestionFile(null);
      setAnswerFile(null);
      setTags([]);
      if (questionImageInputRef.current) questionImageInputRef.current.value = '';
      if (answerImageInputRef.current) answerImageInputRef.current.value = '';
      if (questionFileInputRef.current) questionFileInputRef.current.value = '';
      if (answerFileInputRef.current) answerFileInputRef.current.value = '';

    } catch (err: any) {
      console.error('上传失败:', err);
      setError(err.message || '上传失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 pb-20 sm:pb-0">
      {/* 背景 */}
      

      <div className="relative max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-700">上传题目</h1>
          <p className="text-sm sm:text-base text-gray-500 mt-1">支持文本、图片和文档三种上传方式</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6 shadow-lg">
          {/* 提醒信息 */}
          <div className="bg-gray-100/80 border border-gray-300/50 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg">
            <p className="text-xs sm:text-sm text-gray-600">
              ⚠️ <strong>请遵守社区规范：</strong>禁止上传违法违规、色情暴力、广告刷屏等内容。所有内容需经审核后显示。
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* 团队选择 - 仅当选择团队可见时显示 */}
          {visibility === 'class' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                选择团队 <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full px-3 sm:px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none text-gray-800 text-sm"
                disabled={loading}
              >
                <option value="">请选择团队</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                    {cls.userRole === 'creator' && ' (管理员)'}
                  </option>
                ))}
              </select>
              {classes.length === 0 && (
                <p className="mt-1.5 text-xs sm:text-sm text-gray-500">
                  还没有加入团队，请先 <a href="/classes" className="text-gray-600 hover:text-gray-700 underline">创建或加入团队</a>
                </p>
              )}
            </div>
          )}

          {/* 可见性选择 */}
          <div className="bg-gray-50/80 border border-gray-200 rounded-lg p-3 sm:p-4">
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
                  disabled={loading}
                  className="mt-1 w-4 h-4 text-gray-500 bg-white border-gray-300 rounded focus:ring-gray-500"
                />
                <div>
                  <span className="text-gray-800 group-hover:text-gray-900 transition-colors text-sm">
                    <strong>仅本团队可见</strong>
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">只有该团队的成员可以看到此题目</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={(e) => setVisibility(e.target.value as 'class' | 'public')}
                  disabled={loading}
                  className="mt-1 w-4 h-4 text-gray-500 bg-white border-gray-300 rounded focus:ring-gray-500"
                />
                <div>
                  <span className="text-gray-800 group-hover:text-gray-900 transition-colors text-sm">
                    <strong>全部可见</strong>
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">所有用户都可以看到此题目</p>
                </div>
              </label>
            </div>
          </div>

          {/* 上传类型选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              上传方式
            </label>
            <div className="flex gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setUploadType('text')}
                className={`flex-1 px-3 sm:px-4 py-2 rounded-lg transition-colors text-sm ${
                  uploadType === 'text'
                    ? 'bg-gray-500 text-white'
                    : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                }`}
                disabled={loading}
              >
                文本输入
              </button>
              <button
                type="button"
                onClick={() => setUploadType('image')}
                className={`flex-1 px-3 sm:px-4 py-2 rounded-lg transition-colors text-sm ${
                  uploadType === 'image'
                    ? 'bg-gray-500 text-white'
                    : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                }`}
                disabled={loading}
              >
                图片上传
              </button>
              <button
                type="button"
                onClick={() => setUploadType('file')}
                className={`flex-1 px-3 sm:px-4 py-2 rounded-lg transition-colors text-sm ${
                  uploadType === 'file'
                    ? 'bg-gray-500 text-white'
                    : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                }`}
                disabled={loading}
              >
                文档上传
              </button>
            </div>
          </div>

          {/* 文本输入模式 */}
          {uploadType === 'text' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  题目内容
                </label>
                <textarea
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  placeholder="输入题目内容..."
                  rows={4}
                  className="w-full px-3 sm:px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none resize-none text-gray-800 placeholder-gray-400 text-sm"
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  答案内容
                </label>
                <textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="输入答案内容..."
                  rows={4}
                  className="w-full px-3 sm:px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 outline-none resize-none text-gray-800 placeholder-gray-400 text-sm"
                  disabled={loading}
                />
              </div>
            </>
          )}

          {/* 图片上传模式 */}
          {uploadType === 'image' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  题目图片
                </label>
                <input
                  ref={questionImageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleImageSelect(e, 'question')}
                  className="hidden"
                  disabled={loading}
                />
                <div
                  onClick={() => !loading && questionImageInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 text-center hover:border-gray-500 transition-colors cursor-pointer bg-white/50"
                >
                  {questionImage ? (
                    <div className="space-y-2">
                      <img src={questionImage.preview} alt="题目预览" className="max-h-48 mx-auto rounded-lg" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          removeImage('question');
                        }}
                        className="text-sm text-red-500 hover:text-red-600"
                      >
                        移除图片
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-4xl">📷</div>
                      <p className="text-gray-500 text-sm">点击上传题目图片</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  答案图片
                </label>
                <input
                  ref={answerImageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleImageSelect(e, 'answer')}
                  className="hidden"
                  disabled={loading}
                />
                <div
                  onClick={() => !loading && answerImageInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 text-center hover:border-gray-500 transition-colors cursor-pointer bg-white/50"
                >
                  {answerImage ? (
                    <div className="space-y-2">
                      <img src={answerImage.preview} alt="答案预览" className="max-h-48 mx-auto rounded-lg" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          removeImage('answer');
                        }}
                        className="text-sm text-red-500 hover:text-red-600"
                      >
                        移除图片
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-4xl">📷</div>
                      <p className="text-gray-500 text-sm">点击上传答案图片</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* 文件上传模式 */}
          {uploadType === 'file' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  题目文件
                </label>
                <input
                  ref={questionFileInputRef}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  onChange={(e) => handleFileSelect(e, 'question')}
                  className="hidden"
                  disabled={loading}
                />
                <div
                  onClick={() => !loading && questionFileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 text-center hover:border-gray-500 transition-colors cursor-pointer bg-white/50"
                >
                  {questionFile ? (
                    <div className="space-y-2">
                      <div className="text-4xl">📄</div>
                      <p className="font-medium text-gray-700 text-sm">{questionFile.name}</p>
                      <p className="text-sm text-gray-500">{formatFileSize(questionFile.size)}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          removeFile('question');
                        }}
                        className="text-sm text-red-500 hover:text-red-600"
                      >
                        移除文件
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-4xl">📁</div>
                      <p className="text-gray-500 text-sm">点击选择题目文件</p>
                      <p className="text-xs text-gray-400">
                        支持图片、PDF、Word、PPT、Excel 等格式
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  答案文件
                </label>
                <input
                  ref={answerFileInputRef}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  onChange={(e) => handleFileSelect(e, 'answer')}
                  className="hidden"
                  disabled={loading}
                />
                <div
                  onClick={() => !loading && answerFileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 text-center hover:border-gray-500 transition-colors cursor-pointer bg-white/50"
                >
                  {answerFile ? (
                    <div className="space-y-2">
                      <div className="text-4xl">📄</div>
                      <p className="font-medium text-gray-700 text-sm">{answerFile.name}</p>
                      <p className="text-sm text-gray-500">{formatFileSize(answerFile.size)}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          removeFile('answer');
                        }}
                        className="text-sm text-red-500 hover:text-red-600"
                      >
                        移除文件
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-4xl">📁</div>
                      <p className="text-gray-500 text-sm">点击选择答案文件</p>
                      <p className="text-xs text-gray-400">
                        支持图片、PDF、Word、PPT、Excel 等格式
                      </p>
                    </div>
                  )}
                </div>
              </div>
              {fileError && (
                <p className="mt-2 text-sm text-red-500">{fileError}</p>
              )}
            </>
          )}

          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              标签 <span className="text-red-500">*</span>
            </label>
            <TagInput
              tags={tags}
              onChange={setTags}
              availableTags={availableTags}
              placeholder="添加标签（如：高等数学、力学）"
            />
          </div>

          {/* 提交按钮 */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || (visibility === 'class' && !selectedClassId)}
              className="w-full py-3 sm:py-3.5 bg-gray-500 text-white rounded-lg font-medium hover:bg-gray-600 transition disabled:bg-gray-300 disabled:cursor-not-allowed text-base"
            >
              {loading ? '上传中...' : '上传题目'}
            </button>
          </div>
        </form>

        {/* 提示信息 */}
        <div className="mt-4 sm:mt-6 bg-gray-50/80 border border-gray-200 rounded-lg p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-gray-600">
            <strong>提示：</strong>上传的题目需要经过管理员或团队审核员审核后才能在题库中显示。
            {visibility === 'class' && ' 只有该团队的成员可以看到此题目。'}
          </p>
        </div>
      </div>
    </div>
  );
}
