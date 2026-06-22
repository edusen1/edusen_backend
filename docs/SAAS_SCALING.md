# Scalability SaaS

## API replicas

Deploy two or more API replicas behind Coolify's proxy when traffic requires it. They must share the same PostgreSQL, Redis and S3/MinIO configuration.

Set `WHATSAPP_CLIENT_ENABLED=false` on every API replica. These instances authenticate users, serve dashboards and enqueue WhatsApp messages without starting Chromium.

Set `DATABASE_CONNECTION_LIMIT` per replica, not for the whole cluster. A conservative starting point is `8`; keep the sum of all application pools below PostgreSQL's available connection budget.

## WhatsApp worker

Deploy one additional instance from the same image with:

```env
WHATSAPP_CLIENT_ENABLED=true
WHATSAPP_AUTOSTART=true
WHATSAPP_SESSION_STORAGE=s3
```

The worker restores sessions, owns Chromium clients and drains the Redis outbox. It does not need public traffic. Session archives are stored in S3/MinIO, leaving Redis for small metadata and queues.

## Health checks

- `/api/health` is a liveness endpoint.
- `/api/health/ready` verifies PostgreSQL and is used by the Docker health check.

## Capacity controls

- `HTTP_RATE_LIMIT_MAX` controls requests per IP and minute.
- `HTTP_BODY_LIMIT_BYTES` protects memory from oversized JSON bodies.
- `WHATSAPP_SESSION_SAVE_CONCURRENCY=1` prevents concurrent large archive writes.
- `PRISMA_READ_RETRY_ATTEMPTS=2` retries short, safe dashboard/configuration reads after a transient `P1001`.
