"""
信用卡账单查询系统 - FastAPI 入口
"""
import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="信用卡账单查询", version="1.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

_HERE = os.path.dirname(os.path.abspath(__file__))

# 注册路由模块
from api.search import router as search_router
from api.meta import router as meta_router
from api.export import router as export_router
from api.imports import router as import_router

app.include_router(search_router, prefix="/api")
app.include_router(meta_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(import_router, prefix="/api")

@app.get("/")
def index():
    return FileResponse(os.path.join(_HERE, "index.html"))

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.2.0", "transactions": "13 banks"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
