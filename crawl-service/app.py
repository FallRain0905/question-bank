from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Optional
from urllib.request import Request, urlopen

from fastapi import FastAPI
from pydantic import BaseModel, Field, HttpUrl

try:
    from crawl4ai import AsyncWebCrawler  # type: ignore
except Exception:  # pragma: no cover - optional runtime dependency fallback
    AsyncWebCrawler = None


app = FastAPI(title="SynapFlow Crawl Service", version="0.1.0")


class CrawlRequest(BaseModel):
    url: HttpUrl
    query: Optional[str] = None
    max_chars: int = Field(default=3500, ge=300, le=20000)


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag in {"p", "br", "li", "section", "article", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if tag == "title":
            self._in_title = False
        if tag in {"p", "li", "section", "article", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text:
            return
        if self._in_title:
            self.title = f"{self.title} {text}".strip()
        if self._skip_depth == 0:
            self.parts.append(text)


def compact(text: str, max_chars: int) -> str:
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:max_chars]


async def crawl_with_crawl4ai(url: str, max_chars: int) -> tuple[str, str]:
    if AsyncWebCrawler is None:
        raise RuntimeError("crawl4ai is not installed")

    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url)
    markdown = getattr(result, "markdown", "") or getattr(result, "cleaned_html", "") or ""
    title = getattr(result, "metadata", {}).get("title", "") if getattr(result, "metadata", None) else ""
    return title, compact(markdown, max_chars)


def crawl_with_stdlib(url: str, max_chars: int) -> tuple[str, str]:
    request = Request(
        url,
        headers={
            "User-Agent": "SynapFlow crawl-service/0.1 (+https://synap.fallrain0905.top)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(request, timeout=15) as response:
        raw = response.read(min(max_chars * 8, 2_000_000))
        encoding = response.headers.get_content_charset() or "utf-8"
    html = raw.decode(encoding, errors="ignore")
    parser = TextExtractor()
    parser.feed(html)
    markdown = compact("\n".join(parser.parts), max_chars)
    return parser.title, markdown


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/crawl")
async def crawl(payload: CrawlRequest) -> dict[str, str]:
    url = str(payload.url)
    try:
        title, markdown = await crawl_with_crawl4ai(url, payload.max_chars)
        status = "ok"
    except Exception as crawl4ai_error:
        try:
            title, markdown = crawl_with_stdlib(url, payload.max_chars)
            status = "fallback"
        except Exception as fallback_error:
            return {
                "title": "",
                "url": url,
                "markdown": "",
                "excerpt": "",
                "status": f"error: {fallback_error or crawl4ai_error}",
            }

    excerpt = compact(markdown, min(payload.max_chars, 1200))
    return {
        "title": title,
        "url": url,
        "markdown": markdown,
        "excerpt": excerpt,
        "status": status,
    }
