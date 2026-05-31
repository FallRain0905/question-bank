# Crawl Service

Small Python sidecar used by the research search pipeline to read web page bodies after Tavily returns candidate URLs.

## Local start

```bash
cd crawl-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8002
```

Set `CRAWL_SERVICE_URL=http://localhost:8002` for the Next.js app. If Crawl4AI cannot run in the environment, the service falls back to a simple stdlib HTML text extractor so search still works.
