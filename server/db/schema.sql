-- Professional ERP schema: Double-Entry, FIFO, Barter, Multi-Currency, Audit.
-- Base currency: SYP. Indexed for reporting and AI fraud analysis.

-- Chart of Accounts (Syrian trade)
CREATE TABLE IF NOT EXISTS accounts (
  id            VARCHAR(20) PRIMARY KEY,
  code          VARCHAR(20) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  type          VARCHAR(20) NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_accounts_type ON accounts(type);

-- Journal Entries (double-entry: every row is one debit/credit pair)
CREATE TABLE IF NOT EXISTS journal_entries (
  id                VARCHAR(64) PRIMARY KEY,
  date              TIMESTAMP NOT NULL,
  debit_account_id  VARCHAR(20) NOT NULL REFERENCES accounts(id),
  credit_account_id VARCHAR(20) NOT NULL REFERENCES accounts(id),
  amount_syp        DECIMAL(18,4) NOT NULL,
  amount_usd_at_tx  DECIMAL(18,6),
  amount_gold_at_tx DECIMAL(18,6),
  ref_type          VARCHAR(32),
  ref_id            VARCHAR(64),
  memo              TEXT,
  created_by        VARCHAR(64),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted           BOOLEAN DEFAULT FALSE,
  deleted_at        TIMESTAMP,
  deleted_by        VARCHAR(64),
  delete_reason_code VARCHAR(32)
);

CREATE INDEX idx_journal_date ON journal_entries(date);
CREATE INDEX idx_journal_ref ON journal_entries(ref_type, ref_id);
CREATE INDEX idx_journal_debit ON journal_entries(debit_account_id);
CREATE INDEX idx_journal_credit ON journal_entries(credit_account_id);
CREATE INDEX idx_journal_deleted ON journal_entries(deleted);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id                    VARCHAR(64) PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  sku                   VARCHAR(64),
  default_unit_id       VARCHAR(32) NOT NULL,
  cost_per_default_unit  DECIMAL(18,4) NOT NULL DEFAULT 0,
  active                BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_sku ON products(sku);

-- Stock Units
CREATE TABLE IF NOT EXISTS stock_units (
  id     VARCHAR(32) PRIMARY KEY,
  name   VARCHAR(64) NOT NULL,
  symbol VARCHAR(16),
  type   VARCHAR(16) DEFAULT 'discrete'
);

-- Fractioning rules (bulk ↔ sub-unit)
CREATE TABLE IF NOT EXISTS fractioning_rules (
  id               VARCHAR(64) PRIMARY KEY,
  product_id       VARCHAR(64) NOT NULL REFERENCES products(id),
  bulk_unit_id     VARCHAR(32) NOT NULL REFERENCES stock_units(id),
  sub_unit_id      VARCHAR(32) NOT NULL REFERENCES stock_units(id),
  factor           DECIMAL(18,4) NOT NULL,
  cost_per_sub_unit DECIMAL(18,4),
  price_per_sub_unit DECIMAL(18,4),
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fractioning_product ON fractioning_rules(product_id);

-- Inventory (aggregate quantity per product/unit)
CREATE TABLE IF NOT EXISTS inventory (
  product_id  VARCHAR(64) NOT NULL REFERENCES products(id),
  unit_id     VARCHAR(32) NOT NULL REFERENCES stock_units(id),
  quantity    DECIMAL(18,4) NOT NULL DEFAULT 0,
  reserved    DECIMAL(18,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, unit_id)
);

-- FIFO lots (costing)
CREATE TABLE IF NOT EXISTS inventory_lots (
  id          VARCHAR(64) PRIMARY KEY,
  product_id  VARCHAR(64) NOT NULL REFERENCES products(id),
  unit_id     VARCHAR(32) NOT NULL REFERENCES stock_units(id),
  quantity    DECIMAL(18,4) NOT NULL,
  remaining   DECIMAL(18,4) NOT NULL,
  unit_cost_syp DECIMAL(18,4) NOT NULL,
  received_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_lots_product_unit ON inventory_lots(product_id, unit_id);
CREATE INDEX idx_lots_received ON inventory_lots(received_at);

-- Barter
CREATE TABLE IF NOT EXISTS barter_offers (
  id           VARCHAR(64) PRIMARY KEY,
  product_id   VARCHAR(64) NOT NULL REFERENCES products(id),
  product_name VARCHAR(255),
  quantity     DECIMAL(18,4) NOT NULL,
  user_id      VARCHAR(64),
  type         VARCHAR(16) NOT NULL CHECK (type IN ('surplus','need')),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS barter_ledger (
  id              VARCHAR(64) PRIMARY KEY,
  match_alert_id  VARCHAR(64),
  product_id      VARCHAR(64),
  product_name    VARCHAR(255),
  fair_value_syp  DECIMAL(18,4),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_barter_type ON barter_offers(type);
CREATE INDEX idx_barter_product ON barter_offers(product_id);

-- Debt Ledger (indexed by Gold for valuation)
CREATE TABLE IF NOT EXISTS debt_ledger (
  id              VARCHAR(64) PRIMARY KEY,
  debtor_id       VARCHAR(64),
  amount_syp      DECIMAL(18,4) NOT NULL,
  amount_gold_at_tx DECIMAL(18,6),
  due_date        DATE,
  ref_type        VARCHAR(32),
  ref_id          VARCHAR(64),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_debt_gold ON debt_ledger(amount_gold_at_tx);
CREATE INDEX idx_debt_due ON debt_ledger(due_date);

-- Exchange rates (currency -> rate to base SYP: 1 unit = rate SYP)
CREATE TABLE IF NOT EXISTS exchange_rates (
  currency  VARCHAR(8) PRIMARY KEY,
  rate      DECIMAL(18,8) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Action Log (Audit Trail) for fraud analysis
CREATE TABLE IF NOT EXISTS action_log (
  id          VARCHAR(64) PRIMARY KEY,
  action      VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64),
  entity_id   VARCHAR(64),
  old_value   TEXT,
  new_value   TEXT,
  reason_code VARCHAR(32),
  user_id     VARCHAR(64),
  memo        TEXT,
  at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_action ON action_log(action);
CREATE INDEX idx_audit_entity ON action_log(entity_type, entity_id);
CREATE INDEX idx_audit_at ON action_log(at);
