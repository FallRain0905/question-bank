'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// 配置PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface Progress {
  current: number;
  total: number;
  percent: number;
}

interface TaskData {
  task_id: string;
  state: string;
  extracted_pages?: number;
  total_pages?: number;
  full_zip_url?: string;
  err_msg?: string;
}

export default function ConvertPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string>('');
  const [progress, setProgress] = useState<Progress>({ current: 0, total: 0, percent: 0 });
  const [status, setStatus] = useState<string>('idle'); // idle, uploading, processing, completed, error
  const [markdown, setMarkdown] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [pdfPages, setPdfPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // 获取状态文本
  const getStatusText = () => {
    switch (status) {
      case 'idle': return '请上传文档开始转换';
      case 'uploading': return '正在上传文档...';
      case 'processing': return '正在转换文档...';
      case 'completed': return '转换完成！';
      case 'error': return '转换失败';
      default: return '准备就绪';
    }
  };

  // 处理文件选择
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!selectedFile) return;

    // 检查文件类型
    const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
    if (!validTypes.includes(selectedFile.type)) {
      setErrorMessage('不支持的文件格式，请上传PDF、DOCX或DOC文件');
      setStatus('error');
      return;
    }

    setFile(selectedFile);
    setErrorMessage('');
    setStatus('uploading');

    // 创建本地预览URL
    const localUrl = URL.createObjectURL(selectedFile);
    setFileUrl(localUrl);

    // 如果是PDF，开始转换
    if (selectedFile.type === 'application/pdf') {
      await startConversion(selectedFile);
    } else {
      setStatus('completed');
      setMarkdown('DOCX/DOC文件暂不支持预览，请等待转换功能完善。');
    }
  }, []);

  // 开始转换
  const startConversion = async (pdfFile: File) => {
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setErrorMessage('请先登录');
        setStatus('error');
        return;
      }

      setStatus('processing');

      // 上传文件到Supabase Storage
      const fileName = `convert-temp/${Date.now()}-${pdfFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('files')
        .upload(fileName, pdfFile, {
          contentType: pdfFile.type,
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`文件上传失败: ${uploadError.message}`);
      }

      // 获取文件URL
      const { data: publicData } = supabase.storage.from('files').getPublicUrl(fileName);
      const fileUrl = publicData.publicUrl;

      // 创建MinerU转换任务
      const createResponse = await fetch('/api/convert/task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ fileUrl, fileName: pdfFile.name }),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        throw new Error(errorData.error || '创建转换任务失败');
      }

      const createData = await createResponse.json();

      if (createData.error) {
        throw new Error(createData.error);
      }

      // 开始轮询进度
      startPolling(createData.task_id, session.access_token);
    } catch (error: any) {
      console.error('转换错误:', error);
      setErrorMessage(error.message || '转换失败，请重试');
      setStatus('error');
    }
  };

  // 轮询进度
  const startPolling = (taskID: string, token: string) => {
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/convert/progress?taskId=${taskID}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('查询进度失败');
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        const taskData: TaskData = data.data;

        // 更新进度
        if (taskData.extracted_pages && taskData.total_pages) {
          const percent = Math.round((taskData.extracted_pages / taskData.total_pages) * 100);
          setProgress({
            current: taskData.extracted_pages,
            total: taskData.total_pages,
            percent,
          });
        }

        // 检查任务状态
        if (taskData.state === 'done') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }

          setStatus('completed');

          // 获取转换结果
          if (taskData.full_zip_url) {
            await fetchConvertResult(taskData.full_zip_url);
          }
        } else if (taskData.state === 'failed') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }

          setStatus('error');
          setErrorMessage(taskData.err_msg || '转换失败');
        }
      } catch (error: any) {
        console.error('轮询进度错误:', error);
        // 继续轮询，不中断
      }
    }, 2000); // 每2秒轮询一次
  };

  // 获取转换结果
  const fetchConvertResult = async (zipUrl: string) => {
    try {
      // 这里需要实现ZIP文件解析，暂时显示占位文本
      setMarkdown('转换完成！Markdown结果已生成。\n\n(注：ZIP文件解析功能待实现，请使用下载功能获取完整结果)');
    } catch (error: any) {
      console.error('获取结果错误:', error);
      setErrorMessage('获取转换结果失败');
    }
  };

  // 处理拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    handleFileSelect(droppedFile);
  };

  // 处理点击上传
  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  // 处理PDF加载成功
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setPdfPages(numPages);
    setCurrentPage(1);
  };

  // 翻页
  const goToPrevPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(pdfPages, prev + 1));
  };

  // 下载Markdown
  const handleDownloadMarkdown = () => {
    if (!markdown) return;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name.replace(/\.[^/.]+$/, '') || 'converted'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 复制Markdown
  const handleCopyMarkdown = () => {
    if (!markdown) return;

    navigator.clipboard.writeText(markdown).then(() => {
      alert('已复制到剪贴板');
    }).catch(() => {
      alert('复制失败');
    });
  };

  return (
    <div className="flex h-[calc(100vh-1px)]">
      {/* 左侧：PDF预览和上传区域 */}
      <div className="w-1/2 border-r border-gray-100 bg-white overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-1 inline-block">← 返回首页</Link>
              <h1 className="text-2xl font-bold text-gray-900 mt-1">文档转换</h1>
              <p className="text-sm text-gray-500 mt-1">上传PDF、DOCX等文档，转换为Markdown格式</p>
            </div>
          </div>

          {/* 文件上传区域 */}
          {!file && (
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
                isDragging ? 'border-gray-900 bg-gray-50' : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleClick}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <div className="text-4xl mb-4">📄</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">拖拽文件到这里</h3>
              <p className="text-sm text-gray-500 mb-4">或者点击选择文件</p>
              <p className="text-xs text-gray-400">支持 PDF、DOCX、DOC 格式，最大 200MB</p>
            </div>
          )}

          {/* 文件信息和进度 */}
          {file && (
            <div className="space-y-4">
              {/* 文件信息 */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium uppercase">
                      {file.name.split('.').pop()}
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">{file.name}</h4>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null);
                      setFileUrl('');
                      setMarkdown('');
                      setStatus('idle');
                      setProgress({ current: 0, total: 0, percent: 0 });
                      setErrorMessage('');
                    }}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* 进度显示 */}
              {status !== 'idle' && status !== 'completed' && (
                <div className="bg-white border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">{getStatusText()}</span>
                    {progress.total > 0 && (
                      <span className="text-sm text-gray-500">
                        {progress.current}/{progress.total} 页
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-gray-900 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  {errorMessage && (
                    <p className="text-xs text-red-500 mt-2">{errorMessage}</p>
                  )}
                </div>
              )}

              {/* PDF预览 */}
              {file.type === 'application/pdf' && fileUrl && (
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-gray-900">PDF 预览</h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={goToPrevPage}
                        disabled={currentPage <= 1}
                        className="px-2 py-1 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ← 上一页
                      </button>
                      <span className="text-sm text-gray-600">
                        {currentPage} / {pdfPages}
                      </span>
                      <button
                        onClick={goToNextPage}
                        disabled={currentPage >= pdfPages}
                        className="px-2 py-1 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        下一页 →
                      </button>
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                    <Document
                      file={fileUrl}
                      onLoadSuccess={onDocumentLoadSuccess}
                      loading={<div className="text-center py-8 text-gray-400">加载中...</div>}
                      error={<div className="text-center py-8 text-red-500">PDF加载失败</div>}
                    >
                      <Page
                        pageNumber={currentPage}
                        scale={1.2}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                      />
                    </Document>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：Markdown预览区域 */}
      <div className="w-1/2 bg-white overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Markdown 预览</h2>
            {markdown && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyMarkdown}
                  className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  复制
                </button>
                <button
                  onClick={handleDownloadMarkdown}
                  className="px-4 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                >
                  下载
                </button>
              </div>
            )}
          </div>

          {/* Markdown内容 */}
          {markdown ? (
            <div className="prose prose-sm max-w-none bg-gray-50 rounded-xl p-6 min-h-[400px]">
              <pre className="whitespace-pre-wrap text-sm text-gray-700">{markdown}</pre>
            </div>
          ) : (
            <div className="text-center py-16 bg-gray-50 rounded-xl">
              <div className="text-4xl mb-4">📝</div>
              <p className="text-gray-400 mb-2">等待转换结果</p>
              <p className="text-xs text-gray-300">上传文档后将在此显示Markdown预览</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}