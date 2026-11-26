FROM apache/spark:4.0.1-python3
USER root
RUN pip install --no-cache-dir pyarrow==17.0.0 pandas==2.2.3 numpy==1.26.4
ENV PYTHONPATH=/workspace
WORKDIR /workspace
