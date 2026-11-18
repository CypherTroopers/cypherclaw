-- Generated runtime DDL; the owner supplies search_path and the transaction.

CREATE TABLE "cypher_transfers" (
  "request_id" text COLLATE "C" NOT NULL,
  "quote_id" text COLLATE "C" NOT NULL,
  "node_key" text COLLATE "C" NOT NULL,
  "chain_id" text COLLATE "C" NOT NULL,
  "genesis_hash" text COLLATE "C" NOT NULL,
  "from_address" text COLLATE "C" NOT NULL,
  "to_address" text COLLATE "C" NOT NULL,
  "amount" text COLLATE "C" NOT NULL,
  "value_hex" text COLLATE "C" NOT NULL,
  "nonce_hex" text COLLATE "C" NOT NULL,
  "gas_hex" text COLLATE "C" NOT NULL,
  "gas_price_hex" text COLLATE "C",
  "max_fee_per_gas_hex" text COLLATE "C",
  "max_priority_fee_per_gas_hex" text COLLATE "C",
  "estimated_fee" text COLLATE "C" NOT NULL,
  "tx_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "finality_supported" bigint,
  "block_number" text COLLATE "C",
  "actual_fee" text COLLATE "C",
  "error_code" text COLLATE "C",
  "created_at_ms" bigint NOT NULL,
  "updated_at_ms" bigint NOT NULL,
  PRIMARY KEY ("request_id"),
  CHECK (("status" IN ('unknown', 'submitted', 'included', 'complete', 'failed'))),
  CHECK (("finality_supported" IN (0, 1)))
);

CREATE INDEX "idx_cypher_transfers_node_created" ON "cypher_transfers" (("node_key") ASC, ("created_at_ms") DESC, ("request_id") ASC);
