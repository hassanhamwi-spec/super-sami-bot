FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/probe-venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/probe-venv

COPY requirements-probe.txt ./
RUN /opt/probe-venv/bin/pip install --no-cache-dir --only-binary=:all: --requirement requirements-probe.txt \
    && rm requirements-probe.txt

COPY --chown=node:node package.json index.js cloud_db_probe.py ./
COPY --chown=node:node src ./src

USER node

EXPOSE 10000

CMD ["sh", "-c", "python cloud_db_probe.py && exec node index.js"]
