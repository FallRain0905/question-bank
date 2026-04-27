-- 论坛（社区）功能数据库表

-- 1. 帖子表
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    image_url TEXT,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 帖子点赞表
CREATE TABLE IF NOT EXISTS post_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

-- 3. 帖子评论表
CREATE TABLE IF NOT EXISTS post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES post_comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON post_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_parent_id ON post_comments(parent_id);

-- 启用 RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

-- 帖子表的 RLS 策略
DROP POLICY IF EXISTS "所有人可以查看帖子" ON posts;
CREATE POLICY "所有人可以查看帖子" ON posts FOR SELECT USING (true);

DROP POLICY IF EXISTS "认证用户可以发帖" ON posts;
CREATE POLICY "认证用户可以发帖" ON posts FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "用户可以删除自己的帖子" ON posts;
CREATE POLICY "用户可以删除自己的帖子" ON posts FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "用户可以更新自己的帖子" ON posts;
CREATE POLICY "用户可以更新自己的帖子" ON posts FOR UPDATE USING (auth.uid() = user_id);

-- 点赞表的 RLS 策略
DROP POLICY IF EXISTS "所有人可以查看点赞" ON post_likes;
CREATE POLICY "所有人可以查看点赞" ON post_likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "认证用户可以点赞" ON post_likes;
CREATE POLICY "认证用户可以点赞" ON post_likes FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "用户可以取消自己的点赞" ON post_likes;
CREATE POLICY "用户可以取消自己的点赞" ON post_likes FOR DELETE USING (auth.uid() = user_id);

-- 评论表的 RLS 策略
DROP POLICY IF EXISTS "所有人可以查看评论" ON post_comments;
CREATE POLICY "所有人可以查看评论" ON post_comments FOR SELECT USING (true);

DROP POLICY IF EXISTS "认证用户可以评论" ON post_comments;
CREATE POLICY "认证用户可以评论" ON post_comments FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "用户可以删除自己的评论" ON post_comments;
CREATE POLICY "用户可以删除自己的评论" ON post_comments FOR DELETE USING (auth.uid() = user_id);

-- 触发器：点赞时更新帖子点赞数
CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_post_like_change ON post_likes;
CREATE TRIGGER on_post_like_change
    AFTER INSERT OR DELETE ON post_likes
    FOR EACH ROW
    EXECUTE FUNCTION update_post_likes_count();

-- 触发器：评论时更新帖子评论数
CREATE OR REPLACE FUNCTION update_post_comments_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_post_comment_change ON post_comments;
CREATE TRIGGER on_post_comment_change
    AFTER INSERT OR DELETE ON post_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_post_comments_count();
