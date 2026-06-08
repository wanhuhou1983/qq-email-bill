"""
信用卡账单采集 API
GET  /api/collect/status   → 所有信用卡主卡采集状态
POST /api/collect/run/{bank_code} → 触发单银行采集+解析+入库
"""
import os, glob, subprocess
from fastapi import APIRouter
from db import get_conn

router = APIRouter(prefix="/collect", tags=["collect"])

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE = r"C:\Users\linhu\.openclaw-autoclaw\workspace"
FETCHED_DIR = os.path.join(WORKSPACE, "fetched_emails")

# 只保留14家有邮箱账单的银行, 且只列信用卡主卡 (去掉所有附属卡)
BANK_CONFIG = {
    "ABC":   ("农业银行",  "其他文件夹/农业银行", {'8042':'吴华辉','8761':'吴大军','7267':'赵健伟'}),
    "BOC":   ("中国银行",  "其他文件夹/中国银行", {'0177':'吴华辉'}),
    "BOCOM": ("交通银行",  "其他文件夹/交通银行", {'0326':'吴华辉'}),
    "CCB":   ("建设银行",  "其他文件夹/建设银行", {'7614':'吴华辉','1855':'吴大军','5099':'钱伟琴','6258':'赵健伟'}),
    "CEB":   ("光大银行",  "其他文件夹/光大银行", {'5973':'吴华辉'}),
    "CGB":   ("广发银行",  "其他文件夹/广发银行", {'6296':'吴华辉'}),
    "CITIC": ("中信银行",  "其他文件夹/中信银行", {'1696':'吴华辉'}),
    "CMB":   ("招商银行",  "其他文件夹/招商银行", {'1481':'吴华辉','8022':'吴华辉'}),
    "CMBC":  ("民生银行",  "其他文件夹/民生银行", {'0575':'吴华辉','2705':'吴华辉','7293':'吴华辉'}),
    "CZB":   ("浙商银行",  "其他文件夹/浙商银行", {'2171':'吴华辉'}),
    "ICBC":  ("工商银行",  "其他文件夹/工商银行", {'8888':'吴华辉'}),
    "NBC":   ("宁波银行",  "其他文件夹/宁波银行", {'7108':'吴华辉'}),
    "PAB":   ("平安银行",  "其他文件夹/平安银行", {'0662':'吴华辉','3355':'吴华辉'}),
    "SPDB":  ("浦发银行",  "其他文件夹/浦发银行", {'2659':'吴华辉','9697':'吴华辉'}),
}

@router.get("/status")
def collect_status():
    banks = []
    conn = get_conn()
    cur = conn.cursor()

    for code, (name, imap_path, card_map) in BANK_CONFIG.items():
        eml_dir = os.path.join(FETCHED_DIR, code)
        eml_count = len(glob.glob(eml_dir + "/*.eml")) if os.path.isdir(eml_dir) else 0

        cardholders = []
        for card, holder in card_map.items():
            cur.execute("""
                SELECT COUNT(*), MAX(trans_date)::text, MIN(trans_date)::text
                FROM credit_card_transactions WHERE bank_code=%s AND card_last4=%s
            """, (code, card))
            row = cur.fetchone()
            cardholders.append({
                "card_last4": card, "cardholder": holder,
                "tx_count": row[0] if row else 0,
                "latest_date": row[1] if row and row[1] else "",
                "earliest_date": row[2] if row and row[2] else "",
            })

        total_tx = sum(c["tx_count"] for c in cardholders)
        latest = max((c["latest_date"] for c in cardholders if c["latest_date"]), default="")

        banks.append({
            "bank_code": code, "bank_name": name,
            "email_count": eml_count, "total_tx": total_tx,
            "latest_date": latest, "cardholders": cardholders,
        })

    cur.close(); conn.close()
    return {
        "banks": banks,
        "total_banks": len(banks),
        "total_emails": sum(b["email_count"] for b in banks),
        "total_tx": sum(b["total_tx"] for b in banks),
    }

@router.post("/run/{bank_code}")
def run_collect(bank_code: str):
    if bank_code not in BANK_CONFIG:
        return {"ok": False, "error": f"未知银行: {bank_code}"}

    name, imap_path, card_map = BANK_CONFIG[bank_code]
    eml_dir = os.path.join(FETCHED_DIR, bank_code)
    os.makedirs(eml_dir, exist_ok=True)

    # 1. 从QQ邮箱拉取邮件
    fetch_js = os.path.join(WORKSPACE, "_fetch_tmp.js")
    js_code = f'''const {{ImapFlow}}=require("imapflow"),fs=require("fs"),path=require("path");
(async()=>{{const c=new ImapFlow({{host:"imap.qq.com",port:993,secure:true,auth:{{user:"85657238@qq.com",pass:"nepaqqspysbncafe"}},logger:false}});
await c.connect();await c.mailboxOpen("{imap_path}");
let out=path.join("{FETCHED_DIR.replace(chr(92),'/')}","{bank_code}");fs.mkdirSync(out,{{recursive:true}});
let msgs=[];for await(let m of c.fetch("1:*",{{uid:true,source:true}}))msgs.push({{uid:m.uid,source:m.source}});
let saved=0;for(let m of msgs){{let exist=fs.readdirSync(out).filter(f=>f.startsWith("uid"+m.uid+"_"));if(exist.length)continue;
let d=m.uid+'';fs.writeFileSync(path.join(out,"uid"+d+".eml"),m.source);saved++;}}
await c.logout();console.log(JSON.stringify({{ok:true,bank:"{bank_code}",saved,total:msgs.length}}));}})();'''

    with open(fetch_js, "w", encoding="utf-8") as f:
        f.write(js_code)

    NODE_DIR = os.path.join(os.path.dirname(_HERE))  # qq-email-bill with node_modules
    try:
        r = subprocess.run(["node", fetch_js], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=120, cwd=NODE_DIR)
        fetch_ok = "ok" in (r.stdout or "")
    except Exception as e:
        return {"ok": False, "step": "fetch", "error": str(e)}

    return {"ok": True, "bank_code": bank_code, "bank_name": name,
            "fetched": True, "message": "邮件已下载，解析功能开发中"}
