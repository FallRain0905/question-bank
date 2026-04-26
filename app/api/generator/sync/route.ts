import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const { question_data, source_doc_id, source_text, question_type } = await req.json();
  if (!question_data) return NextResponse.json({ error: '缺少题目数据' }, { status: 400 });

  try {
    // Save to generated_questions table
    const { data: genQ, error: genError } = await supabase
      .from('generated_questions')
      .insert({
        user_id: user.id,
        source_doc_id: source_doc_id || null,
        source_text: source_text || '',
        question_type: question_type || 'choice',
        question_data,
        synced_to_bank: false,
      })
      .select()
      .single();

    if (genError) throw genError;

    // Sync to questions table
    const { data: question, error: qError } = await supabase
      .from('questions')
      .insert({
        user_id: user.id,
        question_text: question_data.question_text,
        answer_text: `${question_data.answer}${question_data.explanation ? '\n\n解析：' + question_data.explanation : ''}`,
        status: 'approved',
        visibility: 'public',
      })
      .select()
      .single();

    if (qError) throw qError;

    // Update sync status
    await supabase
      .from('generated_questions')
      .update({ synced_to_bank: true, synced_question_id: question.id })
      .eq('id', genQ.id);

    return NextResponse.json({
      success: true,
      generated_id: genQ.id,
      question_id: question.id,
    });
  } catch (error: any) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: error.message || '同步失败' }, { status: 500 });
  }
}
