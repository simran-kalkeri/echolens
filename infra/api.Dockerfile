FROM python:3.11-slim
WORKDIR /app
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt
ENV FASTEMBED_CACHE_PATH=/app/.fastembed PYTHONPATH=/app
# warm model caches at build time so the container starts fast
RUN python -c "from fastembed import TextEmbedding; from fastembed.rerank.cross_encoder import TextCrossEncoder; TextEmbedding('BAAI/bge-small-en-v1.5'); TextCrossEncoder('Xenova/ms-marco-MiniLM-L-6-v2')"
COPY api api
COPY analyst analyst
COPY retrieval retrieval
COPY pipeline/__init__.py pipeline/__init__.py
COPY pipeline/common pipeline/common
# serving data: gold lake + themes + per-workspace embedding shards (retrieval) + serving JSON + LLM cache
COPY data/lake/gold data/lake/gold
COPY data/lake/themes data/lake/themes
COPY data/index data/index
COPY data/serving data/serving
COPY data/llm_cache data/llm_cache
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
