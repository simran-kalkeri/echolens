FROM python:3.11-slim
WORKDIR /app
ARG API_REQUIREMENTS=requirements-api.txt
ARG PRELOAD_MODELS=true
COPY requirements-api*.txt ./
RUN pip install --no-cache-dir -r "$API_REQUIREMENTS"
ENV FASTEMBED_CACHE_PATH=/app/.fastembed PYTHONPATH=/app PYTHONUNBUFFERED=1 \
    TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=1
RUN if [ "$PRELOAD_MODELS" = "true" ]; then python -c "from fastembed import TextEmbedding; from fastembed.rerank.cross_encoder import TextCrossEncoder; TextEmbedding('BAAI/bge-small-en-v1.5'); TextCrossEncoder('Xenova/ms-marco-MiniLM-L-6-v2')"; fi
RUN useradd --uid 10001 --create-home appuser && chown -R appuser:appuser /app
COPY --chown=appuser:appuser api api
COPY --chown=appuser:appuser analyst analyst
COPY --chown=appuser:appuser retrieval retrieval
COPY --chown=appuser:appuser pipeline/__init__.py pipeline/__init__.py
COPY --chown=appuser:appuser pipeline/common pipeline/common
COPY --chown=appuser:appuser data/lake/gold data/lake/gold
COPY --chown=appuser:appuser data/lake/themes data/lake/themes
COPY --chown=appuser:appuser data/index data/index
COPY --chown=appuser:appuser data/serving data/serving
COPY --chown=appuser:appuser data/llm_cache data/llm_cache
USER appuser
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --limit-concurrency 12"]
