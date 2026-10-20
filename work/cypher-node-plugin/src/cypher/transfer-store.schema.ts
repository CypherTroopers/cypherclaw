export type TransferRow = {
  request_id: string;
  quote_id: string;
  node_key: string;
  chain_id: string;
  genesis_hash: string;
  from_address: string;
  to_address: string;
  amount: string;
  value_hex: string;
  nonce_hex: string;
  gas_hex: string;
  gas_price_hex: string | null;
  max_fee_per_gas_hex: string | null;
  max_priority_fee_per_gas_hex: string | null;
  estimated_fee: string;
  tx_hash: string;
  status: string;
  finality_supported: number | null;
  block_number: string | null;
  actual_fee: string | null;
  error_code: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type TransferDatabase = { cypher_transfers: TransferRow };

export const TRANSFER_SCHEMA = `
CREATE TABLE cypher_transfers (
  request_id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  genesis_hash TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  value_hex TEXT NOT NULL,
  nonce_hex TEXT NOT NULL,
  gas_hex TEXT NOT NULL,
  gas_price_hex TEXT,
  max_fee_per_gas_hex TEXT,
  max_priority_fee_per_gas_hex TEXT,
  estimated_fee TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unknown','submitted','included','complete','failed')),
  finality_supported INTEGER CHECK (finality_supported IN (0,1)),
  block_number TEXT,
  actual_fee TEXT,
  error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX cypher_transfers_node_created
  ON cypher_transfers(node_key, created_at_ms DESC, request_id);
PRAGMA user_version = 1;
`;
