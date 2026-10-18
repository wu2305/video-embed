# Development image for the multimodal media indexer.
#
# python:3.12-slim has no libGL, which OpenCV (pulled in by insightface) needs.
# Installing the runtime libs here keeps the image small and the model stack
# importable; the ML wheels themselves are installed by the bootstrap stage so
# the cache lives in the workspace rather than the image.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        ffmpeg \
        git \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /workspace
