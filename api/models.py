from datetime import date
from typing import Optional
from pydantic import BaseModel

class TransactionItem(BaseModel):
    id: int
    bank_code: str
    bank_name: str
    cardholder: str
    card_last4: str
    card_type: Optional[str]
    trans_date: date
    post_date: date
    description: str
    category: Optional[str]
    amount: float
    currency: str
    trans_type: str
    source: Optional[str]
    bill_cycle: Optional[str]
    account_masked: Optional[str]

class SearchResult(BaseModel):
    total: int
    sum_spend: float = 0
    sum_repay: float = 0
    transactions: list[TransactionItem]
