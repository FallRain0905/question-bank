// 数据库类型定义

export interface Question {
  id: string;
  user_id: string;
  question_text: string | null;
  question_image_url: string | null;
  question_file_url: string | null;
  question_file_name: string | null;
  question_file_type: string | null;
  question_file_size: number | null;
  answer_text: string | null;
  answer_image_url: string | null;
  answer_file_url: string | null;
  answer_file_name: string | null;
  answer_file_type: string | null;
  answer_file_size: number | null;
  status: 'pending' | 'approved' | 'rejected';
  visibility: 'class' | 'public';
  class_id: string | null;
  created_at: string;
}

export interface QuestionWithTags extends Question {
  tags: Tag[];
  user_email?: string;
  user_name?: string;
  user_avatar_url?: string;
  is_favorited?: boolean;
  favorites_count?: number;
}

export interface Tag {
  id: number;
  name: string;
  created_at?: string;
}

export interface NewQuestion {
  question_text?: string;
  question_image?: File;
  answer_text?: string;
  answer_image?: File;
  tags: string[];
  class_id?: string;
  visibility?: 'class' | 'public';
}

export interface UserProfile {
  id: string;
  email: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  is_admin?: boolean;
}

// 笔记相关类型
export interface Note {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  tags_id: UUID[] | null;
  status: 'pending' | 'approved' | 'rejected';
  visibility: 'class' | 'public';
  class_id: string | null;
  likes_count: number;
  created_at: string;
  updated_at: string;
}

export interface NoteWithTags extends Note {
  tags: Tag[];
  user_email?: string;
  user_name?: string;
  user_avatar_url?: string;
  is_liked?: boolean;
  is_favorited?: boolean;
  favorites_count?: number;
}

export interface NewNote {
  title: string;
  description?: string;
  file?: File;
  tags: string[];
  class_id?: string;
  visibility?: 'class' | 'public';
}

export interface Like {
  id: string;
  user_id: string;
  note_id: string;
  created_at: string;
}

// UUID 类型
export type UUID = string;

// 评论相关类型
export interface Comment {
  id: string;
  user_id: string;
  target_type: 'question' | 'note';
  target_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommentWithUser extends Comment {
  user: {
    id: string;
    username?: string;
    avatar_url?: string;
    email: string;
  };
  replies?: CommentWithUser[];
}

// 收藏相关类型
export interface Favorite {
  id: string;
  user_id: string;
  target_type: 'question' | 'note';
  target_id: string;
  created_at: string;
}

// 通知相关类型
export interface Notification {
  id: string;
  user_id: string;
  type: 'comment' | 'reply' | 'like' | 'follow' | 'approve' | 'class_join';
  title: string;
  content: string | null;
  link: string | null;
  is_read: boolean;
  extra_data?: any;
  created_at: string;
}

// 关注相关类型
export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

// 搜索历史类型
export interface SearchHistory {
  id: string;
  user_id: string;
  query: string;
  created_at: string;
}

// 班级相关类型
export interface Class {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  creator_id: string;
  status?: 'pending' | 'approved' | 'rejected';
  reject_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClassMember {
  id: string;
  class_id: string;
  user_id: string;
  role: 'creator' | 'moderator' | 'member';
  status: 'pending' | 'approved' | 'rejected';
  message?: string;
  joined_at: string;
}

export interface ClassWithRole extends Class {
  userRole?: 'creator' | 'moderator' | 'member';
  userStatus?: 'pending' | 'approved' | 'rejected';
}

// 班级审核申请类型
export interface ClassApprovalRequest {
  id: string;
  class_id: string;
  user_id: string;
  name: string;
  description: string;
  invite_code: string;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  message: string | null;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

// 知识库相关类型
export interface KnowledgeBase {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  document_count?: number;
  created_at: string;
  updated_at: string;
}

export interface KBDocument {
  id: string;
  kb_id: string;
  user_id: string;
  title: string;
  content_md?: string;
  file_url?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  status?: string;
  created_at: string;
  updated_at: string;
}

// 出题机相关类型
export interface GeneratedQuestion {
  id: string;
  user_id: string;
  source_doc_id?: string;
  source_text: string;
  question_type: 'choice' | 'fill_blank' | 'short_answer';
  question_data: QuestionData;
  synced_to_bank: boolean;
  synced_question_id?: string;
  created_at: string;
}

export interface QuestionData {
  question_text: string;
  question_type: string;
  options?: string[];
  answer: string;
  explanation?: string;
}

export interface GenerateQuestionRequest {
  source_text: string;
  requirement: string;
  question_type?: string;
  source_doc_id?: string;
}

export interface UserSettings {
  user_id?: string;
  llm_provider: string;
  llm_api_key: string;
  llm_api_url: string;
  llm_model: string;
  mineru_api_key: string;
}
