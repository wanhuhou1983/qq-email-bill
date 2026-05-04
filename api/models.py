from datetime import date
from typing import Optional
from pydantic import BaseModel

class TransactionItem(BaseModel):
    id: int
    bill_id: Optional[int] = None
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

class DebitTransactionItem(BaseModel):
    id: int
    bank_code: str
    account_number: str
    account_name: str = ''
    trans_date: date
    description: str
    debit: float = 0
    credit: float = 0
    balance: float = 0
    amount: float = 0
    counterparty_name: Optional[str] = ''
    counterparty_bank: Optional[str] = ''
    counterparty_account: Optional[str] = ''

class DebitSearchResult(BaseModel):
    total: int
    sum_income: float = 0
    sum_expense: float = 0
    transactions: list[DebitTransactionItem]
