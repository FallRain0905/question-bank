import { NextRequest, NextResponse } from 'next/server';
import { getUserMineruConfig } from '@/lib/user-settings';

export async function POST(req: NextRequest) {
  try {
    console.log('MinerU API request received');

    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    const { token: mineruToken } = await getUserMineruConfig(token);

    console.log('MinerU token configured:', !!mineruToken);
    console.log('MinerU token length:', mineruToken?.length || 0);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    console.log('File received:', file ? { name: file.name, size: file.size, type: file.type } : 'none');

    if (!file) {
      return NextResponse.json({ error: '请上传 PDF 文件' }, { status: 400 });
    }

    if (!mineruToken || mineruToken.trim() === '') {
      console.error('MinerU token not configured');
      return NextResponse.json({
        error: 'MinerU API Token 未配置，请在设置中填写。\n请在 https://mineru.net/apiManage 获取您的API Token。'
      }, { status: 500 });
    }

    // Step 1: Upload file to get a URL (use Supabase storage)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const fileName = `mineru-temp/${Date.now()}-${file.name}`;

    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/${fileName}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': file.type,
        },
        body: file,
      }
    );

    if (!uploadRes.ok) {
      // Fallback: try base64 approach
      const bytes = await file.arrayBuffer();

      // Submit to MinerU v1 agent API (supports direct file upload, no auth needed)
      const agentForm = new FormData();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      agentForm.append('file', blob, file.name);
      agentForm.append('return_md', 'true');  // 使用字符串 'true'

      console.log('Submitting to MinerU v1 agent API...');

      const agentRes = await fetch('https://mineru.net/api/v1/agent/parse/file', {
        method: 'POST',
        body: agentForm,
      });

      console.log('MinerU v1 response status:', agentRes.status);

      if (!agentRes.ok) {
        const errorText = await agentRes.text();
        console.error('MinerU v1 error:', { status: agentRes.status, errorText });
        return NextResponse.json({ error: `PDF 上传失败 (${agentRes.status}): ${errorText}` }, { status: 500 });
      }

      const agentData = await agentRes.json();
      console.log('MinerU v1 response:', Object.keys(agentData));

      return NextResponse.json({
        success: true,
        markdown: agentData.content || agentData.markdown || agentData.data?.markdown || '',
      });
    }

    // Step 2: Get public URL
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${fileName}`;

    // Step 3: Submit to MinerU v4 API
    console.log('Submitting to MinerU v4 API with file URL:', publicUrl);

    const mineruRes = await fetch("https://mineru.net/api/v4/extract/task", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mineruToken}`,
      },
      body: JSON.stringify({
        file_url: publicUrl,
        return_md: true,
      }),
    });

    console.log('MinerU v4 response status:', mineruRes.status);

    if (!mineruRes.ok) {
      const errText = await mineruRes.text();
      console.error('MinerU v4 API error:', { status: mineruRes.status, errText });
      return NextResponse.json({ error: `MinerU 解析请求失败 (${mineruRes.status}): ${errText}` }, { status: 500 });
    }

    const mineruData = await mineruRes.json();
    console.log('MinerU v4 response:', JSON.stringify(mineruData).substring(0, 300));

    // v4 API is async — poll for result
    if (mineruData.task_id || mineruData.data?.task_id) {
      const taskId = mineruData.task_id || mineruData.data?.task_id;
      console.log('Got task ID:', taskId, 'polling for result...');

      let result: any = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(
          `https://mineru.net/api/v4/extract/task/${taskId}`,
          { headers: { Authorization: `Bearer ${mineruToken}` } }
        );

        if (pollRes.ok) {
          const pollData = await pollRes.json();
          console.log(`Poll attempt ${i+1}/30, status:`, pollData.status);

          if (pollData.status === 'completed' || pollData.data?.status === 'completed') {
            result = pollData.data || pollData;
            break;
          }
          if (pollData.status === 'failed' || pollData.data?.status === 'failed') {
            console.error('MinerU task failed:', pollData);
            return NextResponse.json({ error: 'MinerU 解析失败' }, { status: 500 });
          }
        }
      }
      if (!result) {
        return NextResponse.json({ error: 'MinerU 解析超时' }, { status: 504 });
      }
      console.log('MinerU v4 result:', Object.keys(result));
      return NextResponse.json({
        success: true,
        markdown: result.markdown || result.content || result.data?.markdown || result.data?.content || '',
      });
    }

    // Fallback: try to extract markdown from immediate response
    return NextResponse.json({
      success: true,
      markdown: mineruData.markdown || mineruData.content || mineruData.data?.markdown || mineruData.data?.content || '',
    });
  } catch (error: any) {
    console.error('MinerU parse error:', error);
    return NextResponse.json({ error: '解析失败: ' + error.message }, { status: 500 });
  }
}
