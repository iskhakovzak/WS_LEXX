// Vitest setup: tests must never see the production DB. Modules that import `pool` from @workspace/db
// need DATABASE_URL at import time (the Pool is lazy — nothing connects until a query runs), so point it
// at the local test database. SQL tests run read-only SELECTs over VALUES(...) and skip when it is down.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/edge_tracker";
process.env.NODE_ENV ??= "test";
