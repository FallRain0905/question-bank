-- Daily Papers: arXiv 论文每日推送
CREATE TABLE IF NOT EXISTS daily_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arxiv_id TEXT UNIQUE NOT NULL,
  title_en TEXT NOT NULL,
  title_zh TEXT,
  abstract_en TEXT,
  summary_zh TEXT,
  authors TEXT[],
  categories TEXT[],
  keywords TEXT[],
  pdf_url TEXT,
  arxiv_url TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_papers_published ON daily_papers(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_papers_keywords ON daily_papers USING GIN(keywords);

-- Paper Favorites
CREATE TABLE IF NOT EXISTS paper_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  paper_id UUID REFERENCES daily_papers(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, paper_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_favorites_user ON paper_favorites(user_id);

-- RLS
ALTER TABLE daily_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read papers" ON daily_papers FOR SELECT USING (true);
CREATE POLICY "Users can favorite papers" ON paper_favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unfavorite papers" ON paper_favorites FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can read favorites" ON paper_favorites FOR SELECT USING (true);
