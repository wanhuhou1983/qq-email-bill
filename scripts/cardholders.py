# -*- coding: utf-8 -*-
"""
Central cardholder mapping for all banks.

Four cardholders: 吴华辉, 吴大军, 钱伟琴, 赵健伟
"""
import re

DEFAULT_CARDHOLDER = "吴华辉"

# Primary card per bank (for headless transactions like repayments)
PRIMARY_CARD = {
    "ICBC": "8888",
    "ABC": "8042",    # 吴华辉
    "CCB": "1855",    # TBD - 吴大军的
    "CMBC": "0575",
    "CMB": "1481",
    "PAB": "3355",
    "SPDB": "2659",
    "BOC": "0177",
    "CEB": "5973",
    "CITIC": "1696",
    "BOCOM": "0326",
    "CGB": "6296",
    "CZB": "2171",
    "NBC": "7108",
}

# Card last4 → cardholder mapping
CARDHOLDER_MAP = {
    "ICBC": {
        "8888": "吴华辉",   # 主卡
        "1465": "吴华辉",   # 吴华辉另一张卡，共享额度
        "2411": "吴华辉",   # 附属卡
        "3751": "吴大军",
        "6402": "吴华辉",   # 附属卡
    },
    "ABC": {
        "8761": "吴大军",
        "7267": "赵健伟",   # 交易描述含"赵健伟"
        "8042": "吴华辉",   # 主卡
    },
    "CCB": {
        "5099": "钱伟琴",
        "6258": "赵健伟",
        "1855": "吴大军",
        "7614": "吴华辉",   # 主卡
    },
    "CMBC": {
        "0575": "吴华辉",
    },
    "CMB": {
        "1481": "吴华辉",
    },
    "PAB": {
        "3355": "吴华辉",
    },
    "BOC": {
        "0177": "吴华辉",
    },
    "CEB": {
        "5973": "吴华辉",
    },
    "CITIC": {
        "1696": "吴华辉",
    },
    "BOCOM": {
        "0326": "吴华辉",
    },
    "CGB": {
        "6296": "吴华辉",
    },
    "CZB": {
        "2171": "吴华辉",
    },
    "NBC": {
        "7108": "吴华辉",
    },
    "SPDB": {
        "2659": "吴华辉",
    },
}


def get_cardholder(bank_code, card_last4):
    if not card_last4:
        return DEFAULT_CARDHOLDER
    last4 = card_last4[-4:] if len(card_last4) >= 4 else card_last4
    bank_map = CARDHOLDER_MAP.get(bank_code, {})
    return bank_map.get(last4, DEFAULT_CARDHOLDER)


def get_primary_card(bank_code):
    return PRIMARY_CARD.get(bank_code)


def resolve_card(card_raw, bank_code):
    if card_raw:
        digits = "".join(ch for ch in str(card_raw) if ch.isdigit())
        if len(digits) >= 4:
            return digits[-4:]
    return PRIMARY_CARD.get(bank_code)
