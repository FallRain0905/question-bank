"""
Hyper-RAG Microservice for SynapFlow
Provides document indexing and cross-document QA with source tracing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import aiohttp
import asyncio
import hashlib
import json
import os
import sys
import logging
import numpy as np
from pathlib import Path
from datetime import datetime
import importlib.util
import struct
import base64

# Resolve hyperrag package
if importlib.util.find_spec("hyperrag") is None:
    for parent in Path(__file__).resolve().parents:
        if (parent / "hyperrag" / "__init__.py").exists():
            sys.path.insert(0, str(parent))
            break

try:
    from hyperrag import HyperRAG, QueryParam
    from hyperrag.utils import EmbeddingFunc
    from hyperrag.llm import openai_embedding, openai_complete_if_cache
    HYPERRAG_AVAILABLE = True
except ImportError as e:
    print(f"HyperRAG import failed: {e}")
    HYPERRAG_AVAILABLE = False

from hyperdb import HypergraphDB

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hyper-rag-service")

app = FastAPI(title="Hyper-RAG Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKING_DIR = os.environ.get("HYPERRAG_WORKING_DIR", os.path.join(os.path.dirname(__file__), "hyperrag_cache"))
INSTANCES: dict = {}
INSTANCE_CONFIG_HASHES: dict = {}
INDEXING_LOCKS: dict[str, asyncio.Lock] = {}
SYNC_PROGRESS: dict[str, dict] = {}  # kb_id -> {status, progress, entities, relations, ...}

# ======================== Models ========================

class LLMConfig(BaseModel):
    api_key: str
    model_name: str
    base_url: str

class EmbeddingConfig(BaseModel):
    api_key: str
    model_name: str
    base_url: str
    dimensions: int = 1024

class ServiceConfig(BaseModel):
    llm: LLMConfig
    embedding: EmbeddingConfig

class SyncDocumentRequest(BaseModel):
    kb_id: str
    user_id: str
    doc_id: str
    title: str
    content_md: str
    config: ServiceConfig

class SyncBatchRequest(BaseModel):
    kb_id: str
    user_id: str
    documents: list[dict]
    config: ServiceConfig

class QueryRequest(BaseModel):
    kb_id: str
    user_id: str
    question: str
    mode: str = "hyper"
    config: ServiceConfig

# ======================== Factory Functions ========================

def make_llm_func(cfg: LLMConfig):
    # Strip trailing /chat/completions to avoid doubled path
    base_url = cfg.base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        base_url = base_url[: -len("/chat/completions")]

    async def func(prompt, system_prompt=None, history_messages=[], **kwargs):
        return await openai_complete_if_cache(
            cfg.model_name, prompt,
            system_prompt=system_prompt,
            history_messages=history_messages,
            api_key=cfg.api_key,
            base_url=base_url,
            **kwargs,
        )
    return func

def make_embedding_func(cfg: EmbeddingConfig):
    # Build the full embeddings URL
    base_url = cfg.base_url.rstrip("/")
    if not base_url.endswith("/embeddings"):
        base_url = base_url + "/embeddings"

    api_key = cfg.api_key
    if api_key and not api_key.startswith("Bearer "):
        api_key = "Bearer " + api_key

    logger.info(f"[Embedding] url={base_url}, model={cfg.model_name}, key=...{cfg.api_key[-4:] if len(cfg.api_key) > 4 else '***'}")

    async def func(texts: list[str]) -> np.ndarray:
        headers = {"Authorization": api_key, "Content-Type": "application/json"}
        payload = {"model": cfg.model_name, "input": texts, "encoding_format": "base64"}

        async with aiohttp.ClientSession() as session:
            async with session.post(base_url, headers=headers, json=payload) as resp:
                body = await resp.json()
                if resp.status != 200:
                    logger.error(f"[Embedding] HTTP {resp.status}: {body}")
                    raise RuntimeError(f"Embedding API error {resp.status}: {body}")
                # Decode base64 embeddings
                embeddings = []
                for item in body.get("data", []):
                    raw = item.get("embedding", "")
                    if isinstance(raw, str):
                        decode_bytes = base64.b64decode(raw)
                        n = len(decode_bytes) // 4
                        float_array = struct.unpack("<" + "f" * n, decode_bytes)
                        embeddings.append(float_array)
                    else:
                        embeddings.append(raw)
                return np.array(embeddings)

    return EmbeddingFunc(embedding_dim=cfg.dimensions, max_token_size=8192, func=func)

def config_hash(config: ServiceConfig) -> str:
    if hasattr(config, "model_dump"):
        raw_config = config.model_dump()
    else:
        raw_config = config.dict()
    serialized = json.dumps(raw_config, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

def get_or_create_instance(kb_id: str, config: ServiceConfig):
    db_name = f"kb-{kb_id}"
    current_hash = config_hash(config)
    if db_name in INSTANCES and INSTANCE_CONFIG_HASHES.get(db_name) == current_hash:
        return INSTANCES[db_name]
    if db_name in INSTANCES:
        logger.info(f"Config changed for {db_name}; recreating HyperRAG instance")
        INSTANCES.pop(db_name, None)
        INSTANCE_CONFIG_HASHES.pop(db_name, None)

    working_dir = os.path.join(WORKING_DIR, db_name)
    Path(working_dir).mkdir(parents=True, exist_ok=True)

    instance = HyperRAG(
        working_dir=working_dir,
        llm_model_func=make_llm_func(config.llm),
        embedding_func=make_embedding_func(config.embedding),
    )
    INSTANCES[db_name] = instance
    INSTANCE_CONFIG_HASHES[db_name] = current_hash
    return instance


# Cache for directly loaded hypergraph instances (avoids embedding dim mismatch)
_HG_CACHE: dict[str, HypergraphDB] = {}

def load_hypergraph(kb_id: str):
    """Load HypergraphDB directly from disk, bypassing HyperRAG initialization."""
    db_name = f"kb-{kb_id}"
    if db_name in _HG_CACHE:
        return _HG_CACHE[db_name]

    hgdb_file = os.path.join(WORKING_DIR, db_name, "hypergraph_chunk_entity_relation.hgdb")
    if not os.path.exists(hgdb_file):
        return None

    hg = HypergraphDB()
    if hg.load(hgdb_file):
        logger.info(f"Loaded hypergraph from {hgdb_file}: {hg.num_v} vertices, {hg.num_e} edges")
        _HG_CACHE[db_name] = hg
        return hg
    return None

def get_hg(kb_id: str):
    """Get hypergraph from in-memory instance or load from disk."""
    db_name = f"kb-{kb_id}"
    # First try to get from live instance
    if db_name in INSTANCES:
        return INSTANCES[db_name].chunk_entity_relation_hypergraph._hg
    # Otherwise load from disk
    return load_hypergraph(kb_id)

def get_lock(kb_id: str) -> asyncio.Lock:
    key = f"kb-{kb_id}"
    if key not in INDEXING_LOCKS:
        INDEXING_LOCKS[key] = asyncio.Lock()
    return INDEXING_LOCKS[key]

# ======================== Endpoints ========================

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "hyperrag_available": HYPERRAG_AVAILABLE,
        "instances": list(INSTANCES.keys()),
    }

@app.get("/api/sync-progress/{kb_id}")
async def get_sync_progress(kb_id: str):
    progress = SYNC_PROGRESS.get(kb_id)
    if not progress:
        return {"status": "idle"}
    return progress

@app.post("/api/sync-document")
async def sync_document(req: SyncDocumentRequest):
    if not HYPERRAG_AVAILABLE:
        raise HTTPException(500, "HyperRAG library not available")
    if not req.content_md.strip():
        raise HTTPException(400, "Document content is empty")

    lock = get_lock(req.kb_id)
    if lock.locked():
        raise HTTPException(409, "Indexing already in progress for this knowledge base")

    async with lock:
        try:
            instance = get_or_create_instance(req.kb_id, req.config)
            await instance.ainsert(req.content_md)

            working_dir = os.path.join(WORKING_DIR, f"kb-{req.kb_id}")
            return {
                "success": True,
                "message": "Document indexed",
                "database": f"kb-{req.kb_id}",
                "doc_id": req.doc_id,
            }
        except Exception as e:
            logger.error(f"Sync failed: {e}")
            raise HTTPException(500, f"Indexing failed: {str(e)}")

@app.post("/api/sync-batch")
async def sync_batch(req: SyncBatchRequest):
    if not HYPERRAG_AVAILABLE:
        raise HTTPException(500, "HyperRAG library not available")

    lock = get_lock(req.kb_id)
    if lock.locked():
        raise HTTPException(409, "Indexing already in progress for this knowledge base")

    total_docs = len(req.documents)
    SYNC_PROGRESS[req.kb_id] = {
        "status": "running",
        "total_docs": total_docs,
        "processed_docs": 0,
        "current_doc": "",
        "current_step": "initializing",
        "entities": 0,
        "relations": 0,
        "started_at": datetime.now().isoformat(),
    }

    async with lock:
        results = []
        instance = get_or_create_instance(req.kb_id, req.config)

        for doc_idx, doc in enumerate(req.documents):
            doc_id = doc.get("doc_id", f"doc-{doc_idx}")
            doc_title = doc.get("title", "")
            SYNC_PROGRESS[req.kb_id]["processed_docs"] = doc_idx
            SYNC_PROGRESS[req.kb_id]["current_doc"] = doc_title
            SYNC_PROGRESS[req.kb_id]["current_step"] = "chunking"

            try:
                content = doc.get("content_md", "")
                if content.strip():
                    SYNC_PROGRESS[req.kb_id]["current_step"] = "embedding"
                    await instance.ainsert(content)

                    # Read entity/relation counts from the hypergraph
                    try:
                        hg = instance.chunk_entity_relation_hypergraph._hg
                        SYNC_PROGRESS[req.kb_id]["entities"] = len(hg._v_data)
                        SYNC_PROGRESS[req.kb_id]["relations"] = len(hg._e_data)
                    except Exception:
                        pass

                SYNC_PROGRESS[req.kb_id]["current_step"] = "done_doc"
                results.append({"doc_id": doc_id, "success": True})
            except Exception as e:
                SYNC_PROGRESS[req.kb_id]["current_step"] = "error"
                results.append({"doc_id": doc_id, "success": False, "error": str(e)})

        SYNC_PROGRESS[req.kb_id]["processed_docs"] = total_docs
        SYNC_PROGRESS[req.kb_id]["status"] = "done"
        SYNC_PROGRESS[req.kb_id]["current_step"] = "completed"
        SYNC_PROGRESS[req.kb_id]["progress"] = 100.0
        return {"success": True, "results": results, "database": f"kb-{req.kb_id}"}

@app.post("/api/query")
async def query(req: QueryRequest):
    if not HYPERRAG_AVAILABLE:
        raise HTTPException(500, "HyperRAG library not available")

    db_name = f"kb-{req.kb_id}"
    working_dir = os.path.join(WORKING_DIR, db_name)
    if db_name not in INSTANCES and not os.path.exists(working_dir):
        raise HTTPException(404, "Knowledge base not indexed. Please build index first.")
    instance = get_or_create_instance(req.kb_id, req.config)

    try:
        param = QueryParam(
            mode=req.mode,
            only_need_context=False,
            return_type="json",
        )
        result = await instance.aquery(req.question, param)

        if isinstance(result, dict):
            return result
        return {"response": str(result), "entities": [], "hyperedges": [], "text_units": []}
    except Exception as e:
        logger.error(f"Query failed: {e}")
        raise HTTPException(500, f"Query failed: {str(e)}")

@app.get("/api/status/{kb_id}")
async def get_status(kb_id: str):
    db_name = f"kb-{kb_id}"
    working_dir = os.path.join(WORKING_DIR, db_name)
    indexed = os.path.exists(working_dir) and bool(os.listdir(working_dir)) if os.path.exists(working_dir) else False
    return {
        "kb_id": kb_id,
        "database": db_name,
        "indexed": indexed,
        "in_memory": db_name in INSTANCES,
    }

@app.get("/api/entities/{kb_id}")
async def get_entities(kb_id: str, page: int = 1, page_size: int = 20):
    hg = get_hg(kb_id)
    if hg is None:
        raise HTTPException(404, "Knowledge base not indexed")

    try:
        vertices_list = list(hg._v_data.values())
        total = len(vertices_list)
        start = (page - 1) * page_size
        end = start + page_size
        items = vertices_list[start:end]

        return {
            "entities": [
                {"id": v.get("id", ""), "entity_name": v.get("entity_name", ""), "entity_type": v.get("entity_type", ""), "description": v.get("description", "")}
                for v in items
            ],
            "total": total, "page": page, "page_size": page_size,
        }
    except Exception as e:
        logger.error(f"Get entities failed: {e}")
        raise HTTPException(500, str(e))

@app.get("/api/relationships/{kb_id}")
async def get_relationships(kb_id: str, page: int = 1, page_size: int = 20):
    hg = get_hg(kb_id)
    if hg is None:
        raise HTTPException(404, "Knowledge base not indexed")

    try:
        edges_list = list(hg._e_data.values())
        total = len(edges_list)
        start = (page - 1) * page_size
        end = start + page_size
        items = edges_list[start:end]

        return {
            "relationships": [
                {"id": str(e.get("id", "")), "entity_set": e.get("entity_set", ""), "keywords": e.get("keywords", ""), "summary": e.get("summary", "")}
                for e in items
            ],
            "total": total, "page": page, "page_size": page_size,
        }
    except Exception as e:
        logger.error(f"Get relationships failed: {e}")
        raise HTTPException(500, str(e))

@app.get("/api/entity-names/{kb_id}")
async def get_entity_names(kb_id: str, page: int = 1, page_size: int = 50):
    hg = get_hg(kb_id)
    if hg is None:
        raise HTTPException(404, "Knowledge base not indexed")

    try:
        names = list(hg._v_data.keys())
        total = len(names)
        start = (page - 1) * page_size
        end = start + page_size
        return {"names": names[start:end], "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        logger.error(f"Get entity names failed: {e}")
        raise HTTPException(500, str(e))

@app.get("/api/vertex-neighbor/{kb_id}/{vertex_id:path}")
async def get_vertex_neighbor(kb_id: str, vertex_id: str):
    hg = get_hg(kb_id)
    if hg is None:
        raise HTTPException(404, "Knowledge base not indexed")

    try:

        # Get neighbor vertices and incident hyperedges
        try:
            neighbor_vertices = set(hg.nbr_v(vertex_id))
        except Exception:
            neighbor_vertices = set()
        neighbor_vertices.add(vertex_id)

        try:
            neighbor_edges = hg.nbr_e_of_v(vertex_id)
        except Exception:
            neighbor_edges = []

        # Build response
        vertices = {}
        for v in neighbor_vertices:
            v_data = hg.v(v)
            if v_data:
                vertices[v] = v_data

        edges = {}
        for e in neighbor_edges:
            e_data = hg.e(e)
            if e_data:
                d = dict(e_data)
                d["keywords"] = d.get("keywords", "").replace("<SEP>", ",")
                edges["|#|".join(str(x) for x in e)] = d

        return {"vertices": vertices, "edges": edges}
    except Exception as e:
        logger.error(f"Get vertex neighbor failed: {e}")
        raise HTTPException(500, str(e))

# ======================== Entry ========================

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    print(f"Starting Hyper-RAG service on port {port}")
    print(f"Working directory: {WORKING_DIR}")
    print(f"HyperRAG available: {HYPERRAG_AVAILABLE}")
    uvicorn.run(app, host="0.0.0.0", port=port)
