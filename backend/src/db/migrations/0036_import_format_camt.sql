-- CAMT.053 (end-of-day) and CAMT.052 (intraday) XML imports share one enum
-- value: the wrapper differs (BkToCstmrStmt vs BkToCstmrAcctRpt) but the
-- entry shape is identical, and the audit trail only cares that the source
-- was an ISO 20022 statement.
ALTER TYPE import_format ADD VALUE 'camt';
