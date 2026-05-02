"""
数据库连接管理
"""
import os
import psycopg2

def get_conn():
    """读写连接（查询/导入用）"""
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", 5432)),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME", "postgres"),
    )

def get_reader_conn():
    """只读连接（AI查询用），从权限层面防止SQL注入"""
    return psycopg2.connect(
        host=os.getenv("READER_HOST", "localhost"),
        port=int(os.getenv("READER_PORT", 5432)),
        user=os.getenv("READER_USER", "reader"),
        password=os.getenv("READER_PASSWORD", ""),
        database=os.getenv("READER_NAME", "postgres"),
    )
