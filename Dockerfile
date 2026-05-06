# ============================================
# 信用卡账单查询系统 - Dockerfile
# 部署到 Mac Mini Docker，连接已有 PG
# ============================================
FROM python:3.13-slim

WORKDIR /app

# 安装系统依赖（psycopg2 编译需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY app.py db.py .env* ./
COPY api/ ./api/
COPY index.html .

# 不需要的数据文件（不复制）
# - run_import*.py（Windows 专用）
# - .env 通过 docker-compose 挂载
# - 临时脚本不复制

EXPOSE 8765

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765"]
