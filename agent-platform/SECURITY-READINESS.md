# Agent Platform — Security Readiness

## Verified in source / CI

- Owner API routes require a bearer token of at least 32 characters and compare it using a constant-time comparison.
- API request bodies have a size limit; Helmet is enabled and the Express identification header is disabled.
- Generated file paths and extensions are restricted, with limits on file count and total generated content.
- Generated JavaScript is compiled for syntax checking only; it is not executed by the API server.
- Preview uses a sandboxed iframe, a short-lived random capability token, and a restrictive Content Security Policy.
- GitHub Actions tests the API and runs JavaScript syntax checks.
- The security workflow added with this document performs a production dependency audit and repeats the tests.

## Not yet production-ready

- There is no isolated build/test runner for arbitrary generated application code.
- The current generated output is a static web frontend, not a complete full-stack app, native APK, or deployed service.
- The API has a single owner-token model, not multi-user accounts/RBAC.
- A working PostgreSQL database, strong owner token, and provider API credentials must be configured by the operator.
- Do not expose the local API directly to the public internet. Keep secrets in an untracked .env file or a secrets manager.
- A browser preview is not a substitute for a build sandbox or end-to-end test.
- The security gate does not prove the app is secure; it is a minimum automated check and can fail when dependency advisories are found.

## Safe acceptance criteria for the next stage

1. Run generated build/test commands only in a separate disposable sandbox with network disabled by default, non-root user, read-only base filesystem, CPU/memory/PID/time limits, and no production secrets.
2. Add integration tests that verify sandbox isolation and resource/time limits.
3. Add a lockfile and dependency update policy.
4. Add secret scanning and dependency review before enabling automatic pull-request creation.
5. Require explicit owner approval for public deployment, paid services, deletion, external messages, or production permission changes.
6. Do not label a project as built/tested/deployed unless a real runner or deployment provider returned a successful result.
