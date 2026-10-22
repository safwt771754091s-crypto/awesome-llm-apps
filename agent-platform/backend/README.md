# Agent Platform API (MVP foundation)

This service is a separate backend for the Agent Hub. It does not connect to Alfaeq Yemen, Teacher-Safwat, or the school application's databases.

## Current scope

- Owner-token protected task-planning endpoint.
- Server-side call to an OpenAI-compatible chat-completions endpoint.
- PostgreSQL persistence for task plans and audit events.
- Health endpoint, request-size limit, basic in-memory rate limit, Helmet security headers, and request IDs.
- Book-to-app requests can receive a structured plan, but this version does not upload or OCR files, generate project files, execute code, build APKs, or deploy apps.

## Run locally with Docker (recommended)

See [LOCAL-SETUP.md](./LOCAL-SETUP.md). The local web console is served at `http://127.0.0.1:8080` when the Compose stack is running. Docker Compose creates a dedicated PostgreSQL database and keeps its port private.

## Run locally without Docker

Requires Node.js 22.9+ and a PostgreSQL database. Create a database owned only by this platform, then apply `src/schema.sql` (the server also applies it at startup).

1. Copy `.env.example` to `.env`.
2. Set `OWNER_API_TOKEN` to a random secret at least 32 characters long.
3. Set `DATABASE_URL` and, if required, `DATABASE_SSL=true`.
4. Set `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` for the provider you choose.
5. Run `npm install`, then `npm test`, then `npm start`.

Node can load the environment file with `node --env-file=.env src/server.js`; for this, change the package start script locally or export the variables through your shell/hosting provider. Never commit `.env` or real credentials.

## API

- `GET /healthz`: non-secret health status.
- `POST /api/tasks`: requires `Authorization: Bearer <OWNER_API_TOKEN>`. JSON body: `{"prompt":"Build a math learning app","type":"app"}`. Allowed types: `app`, `platform`, `book_to_app`, `general`.
- `GET /api/tasks/:id`: requires the same owner token.

The task endpoint returns a plan, not a completed application. It fails closed if database or model credentials are missing.

## Deployment requirements

Deploy this folder as a separate Node service, with a managed PostgreSQL instance dedicated to this platform. Add secrets only through the host's environment-variable/secret UI. GitHub Pages serves static frontend files and cannot run this API.

## Safety boundary

Do not add a route that executes generated code in this process. Actual code generation should write files into a project workspace; testing/building should run in an isolated, short-lived sandbox with CPU, memory, time, filesystem, and network restrictions. Public deployments, paid services, deletion, and permission changes must require explicit owner approval.
