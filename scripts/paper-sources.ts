/**
 * 多渠道论文收集模块
 * 支持：arXiv、Semantic Scholar、PubMed、bioRxiv、SSRN
 */

export interface PaperSource {
  id: string;
  source: 'arxiv' | 'semantic_scholar' | 'pubmed' | 'biorxiv' | 'ssrn' | 'openreview';
  title: string;
  abstract: string;
  authors: string[];
  publishedDate: string;
  pdfUrl?: string;
  url: string;
  doi?: string;
  citationCount?: number;
  venue?: string;
  categories?: string[];
}

// ======================== arXiv ========================

export async function fetchArxivPapers(
  categories: string[],
  maxResults = 200
): Promise<PaperSource[]> {
  const catQuery = categories.map(c => `cat:${c}`).join(' OR ');
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(catQuery)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'synap-paper-crawler/2.0' },
  });
  if (!res.ok) throw new Error(`arXiv API error ${res.status}`);
  const xml = await res.text();

  const papers: PaperSource[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const idMatch = block.match(/<id>.*?\/abs\/([\w.-]+)<\/id>/);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/);
    const pdfMatch = block.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);

    const authors: string[] = [];
    const authorRegex = /<name>([\s\S]*?)<\/name>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(block)) !== null) {
      authors.push(authorMatch[1].trim());
    }

    const categories: string[] = [];
    const catRegex = /<category[^>]*term="([^"]+)"/g;
    let catMatch;
    while ((catMatch = catRegex.exec(block)) !== null) {
      categories.push(catMatch[1]);
    }

    if (idMatch && titleMatch) {
      papers.push({
        id: `arxiv:${idMatch[1]}`,
        source: 'arxiv',
        title: titleMatch[1].replace(/\s+/g, ' ').trim(),
        abstract: summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : '',
        authors,
        publishedDate: publishedMatch ? publishedMatch[1].trim() : '',
        pdfUrl: pdfMatch ? pdfMatch[1] : `https://arxiv.org/pdf/${idMatch[1]}`,
        url: `https://arxiv.org/abs/${idMatch[1]}`,
        categories,
      });
    }
  }

  return papers;
}

// ======================== Semantic Scholar ========================

export async function fetchSemanticScholarPapers(
  query: string,
  apiKey?: string,
  limit = 100
): Promise<PaperSource[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=paperId,title,abstract,authors,year,publicationDate,citationCount,openAccessPdf,url,externalIds,venue`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Semantic Scholar API error ${res.status}`);
  const data = await res.json();

  const papers: PaperSource[] = [];
  for (const item of data.data || []) {
    papers.push({
      id: `s2:${item.paperId}`,
      source: 'semantic_scholar',
      title: item.title || '',
      abstract: item.abstract || '',
      authors: (item.authors || []).map((a: any) => a.name),
      publishedDate: item.publicationDate || item.year?.toString() || '',
      pdfUrl: item.openAccessPdf?.url || '',
      url: item.url || `https://www.semanticscholar.org/paper/${item.paperId}`,
      doi: item.externalIds?.DOI || '',
      citationCount: item.citationCount || 0,
      venue: item.venue || '',
    });
  }

  return papers;
}

// ======================== PubMed ========================

export async function fetchPubMedPapers(
  query: string,
  maxResults = 100
): Promise<PaperSource[]> {
  // Step 1: 搜索获取 PMID 列表
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json&sort=pub_date`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`PubMed search error ${searchRes.status}`);
  const searchData = await searchRes.json();
  const pmids = searchData.esearchresult?.idlist || [];

  if (pmids.length === 0) return [];

  // Step 2: 获取详细信息
  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=xml`;
  const fetchRes = await fetch(fetchUrl);
  if (!fetchRes.ok) throw new Error(`PubMed fetch error ${fetchRes.status}`);
  const xml = await fetchRes.text();

  const papers: PaperSource[] = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;

  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    const abstractMatch = block.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/);
    const dateMatch = block.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>[\s\S]*?<Month>(\w+)<\/Month>/);
    const doiMatch = block.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);

    const authors: string[] = [];
    const authorRegex = /<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?<ForeName>([^<]*)<\/ForeName>[\s\S]*?<\/Author>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(block)) !== null) {
      authors.push(`${authorMatch[2]} ${authorMatch[1]}`.trim());
    }

    if (pmidMatch && titleMatch) {
      const pmid = pmidMatch[1];
      const doi = doiMatch ? doiMatch[1] : '';
      papers.push({
        id: `pubmed:${pmid}`,
        source: 'pubmed',
        title: titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        abstract: abstractMatch ? abstractMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '',
        authors,
        publishedDate: dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-01` : '',
        pdfUrl: doi ? `https://sci-hub.se/${doi}` : '', // Sci-Hub 镜像（仅供参考）
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        doi,
      });
    }
  }

  return papers;
}

// ======================== bioRxiv ========================

export async function fetchBioRxivPapers(
  startDate: string,
  endDate: string,
  server: 'biorxiv' | 'medrxiv' = 'biorxiv'
): Promise<PaperSource[]> {
  // bioRxiv API: https://api.biorxiv.org/details/{server}/{startDate}/{endDate}
  const url = `https://api.biorxiv.org/details/${server}/${startDate}/${endDate}/0/json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bioRxiv API error ${res.status}`);
  const data = await res.json();

  const papers: PaperSource[] = [];
  for (const item of data.collection || []) {
    papers.push({
      id: `${server}:${item.doi}`,
      source: 'biorxiv',
      title: item.title || '',
      abstract: item.abstract || '',
      authors: (item.authors || '').split(';').map((a: string) => a.trim()).filter(Boolean),
      publishedDate: item.date || '',
      pdfUrl: `https://www.biorxiv.org/content/${item.doi}v${item.version}.full.pdf`,
      url: `https://www.biorxiv.org/content/${item.doi}`,
      doi: item.doi || '',
      venue: server === 'biorxiv' ? 'bioRxiv' : 'medRxiv',
      categories: (item.category || '').split(';').map((c: string) => c.trim()).filter(Boolean),
    });
  }

  return papers;
}

// ======================== SSRN (Social Science Research Network) ========================

export async function fetchSSRNPapers(
  keywords: string[],
  limit = 50
): Promise<PaperSource[]> {
  // SSRN 没有官方 API，这里使用 RSS feed
  const query = keywords.join(' ');
  const url = `https://papers.ssrn.com/sol3/Jeljour_results.cfm?form_name=journalBrowse&journal_id=&search_type=1&npage=1&per_page=${limit}&sortby=submission_date&sortdir=desc&search_text=${encodeURIComponent(query)}`;

  // 注意：实际生产环境建议使用爬虫服务或 SSRN 合作 API
  console.warn('[SSRN] RSS parsing not fully implemented - requires HTML scraping');
  return [];
}

// ======================== OpenReview ========================

export async function fetchOpenReviewPapers(
  venue: string, // 例如 'ICLR.cc/2024/Conference'
  limit = 100
): Promise<PaperSource[]> {
  // OpenReview API v2
  const url = `https://api2.openreview.net/notes?content.venueid=${encodeURIComponent(venue)}&limit=${limit}&sort=cdate:desc`;

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`OpenReview API error ${res.status}`);
  const data = await res.json();

  const papers: PaperSource[] = [];
  for (const note of data.notes || []) {
    const content = note.content || {};
    papers.push({
      id: `openreview:${note.id}`,
      source: 'openreview',
      title: content.title?.value || '',
      abstract: content.abstract?.value || '',
      authors: (content.authors?.value || []),
      publishedDate: new Date(note.cdate || 0).toISOString(),
      pdfUrl: content.pdf ? `https://openreview.net${content.pdf}` : '',
      url: `https://openreview.net/forum?id=${note.id}`,
      venue: venue,
    });
  }

  return papers;
}

// ======================== 统一收集接口 ========================

export interface MultiSourceCollectorOptions {
  arxiv?: {
    categories: string[];
    maxResults?: number;
  };
  semanticScholar?: {
    query: string;
    apiKey?: string;
    limit?: number;
  };
  pubmed?: {
    query: string;
    maxResults?: number;
  };
  biorxiv?: {
    startDate: string; // YYYY-MM-DD
    endDate: string;
    server?: 'biorxiv' | 'medrxiv';
  };
  openreview?: {
    venue: string;
    limit?: number;
  };
}

export async function collectPapersFromMultipleSources(
  options: MultiSourceCollectorOptions
): Promise<PaperSource[]> {
  const allPapers: PaperSource[] = [];
  const errors: string[] = [];

  if (options.arxiv) {
    try {
      console.log('[Collector] Fetching arXiv...');
      const papers = await fetchArxivPapers(
        options.arxiv.categories,
        options.arxiv.maxResults
      );
      allPapers.push(...papers);
      console.log(`[Collector] arXiv: ${papers.length} papers`);
    } catch (err: any) {
      errors.push(`arXiv: ${err.message}`);
      console.error(`[Collector] arXiv failed: ${err.message}`);
    }
  }

  if (options.semanticScholar) {
    try {
      console.log('[Collector] Fetching Semantic Scholar...');
      const papers = await fetchSemanticScholarPapers(
        options.semanticScholar.query,
        options.semanticScholar.apiKey,
        options.semanticScholar.limit
      );
      allPapers.push(...papers);
      console.log(`[Collector] Semantic Scholar: ${papers.length} papers`);
    } catch (err: any) {
      errors.push(`Semantic Scholar: ${err.message}`);
      console.error(`[Collector] Semantic Scholar failed: ${err.message}`);
    }
  }

  if (options.pubmed) {
    try {
      console.log('[Collector] Fetching PubMed...');
      const papers = await fetchPubMedPapers(
        options.pubmed.query,
        options.pubmed.maxResults
      );
      allPapers.push(...papers);
      console.log(`[Collector] PubMed: ${papers.length} papers`);
    } catch (err: any) {
      errors.push(`PubMed: ${err.message}`);
      console.error(`[Collector] PubMed failed: ${err.message}`);
    }
  }

  if (options.biorxiv) {
    try {
      console.log('[Collector] Fetching bioRxiv/medRxiv...');
      const papers = await fetchBioRxivPapers(
        options.biorxiv.startDate,
        options.biorxiv.endDate,
        options.biorxiv.server
      );
      allPapers.push(...papers);
      console.log(`[Collector] bioRxiv: ${papers.length} papers`);
    } catch (err: any) {
      errors.push(`bioRxiv: ${err.message}`);
      console.error(`[Collector] bioRxiv failed: ${err.message}`);
    }
  }

  if (options.openreview) {
    try {
      console.log('[Collector] Fetching OpenReview...');
      const papers = await fetchOpenReviewPapers(
        options.openreview.venue,
        options.openreview.limit
      );
      allPapers.push(...papers);
      console.log(`[Collector] OpenReview: ${papers.length} papers`);
    } catch (err: any) {
      errors.push(`OpenReview: ${err.message}`);
      console.error(`[Collector] OpenReview failed: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    console.warn(`[Collector] Some sources failed: ${errors.join('; ')}`);
  }

  // 去重（基于 DOI 或 标题相似度）
  const deduplicated = deduplicatePapers(allPapers);
  console.log(`[Collector] Total: ${allPapers.length} → Deduplicated: ${deduplicated.length}`);

  return deduplicated;
}

function deduplicatePapers(papers: PaperSource[]): PaperSource[] {
  const seen = new Set<string>();
  const result: PaperSource[] = [];

  for (const paper of papers) {
    // 优先使用 DOI 去重
    if (paper.doi && seen.has(paper.doi)) continue;

    // 使用 ID 去重
    if (seen.has(paper.id)) continue;

    // 使用标题去重（归一化后比较）
    const normalizedTitle = paper.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(normalizedTitle)) continue;

    if (paper.doi) seen.add(paper.doi);
    seen.add(paper.id);
    seen.add(normalizedTitle);
    result.push(paper);
  }

  return result;
}
