# Deployment Plan — Mie Sukses Creative Marketplace

**Status:** Selected production architecture; host configuration and integration verification remain
**Priority:** Reproducibility, security, and operational simplicity within provider limits.

## 1. Deployment Goals

The deployment strategy must:

- Keep operating costs at zero for the initial MVP where feasible.
- Support the React and TypeScript frontend.
- Support a persistent Node.js and TypeScript backend.
- Provide a PostgreSQL database.
- Keep credentials and secrets outside source control.
- Support HTTPS.
- Make deployments reproducible from Git.
- Avoid unnecessary infrastructure complexity.
- Preserve a clear separation between local development and production.

Free-tier availability, resource limits, inactivity policies, and provider terms must be checked before configuring or relying on hosted services.

Zero cost cannot be guaranteed indefinitely.

## 2. Application Components

The application consists of a frontend, backend, database, and object-storage service.

### 2.1 Frontend

The frontend uses React, TypeScript, and Vite.

Responsibilities include:

- Rendering public and authenticated pages.
- Catalog browsing and filtering.
- Profile and dashboard interfaces.
- Cart and checkout interfaces.
- Order status and history.
- Form validation and accessible interaction states.

The frontend must not be responsible for enforcing security-sensitive business rules.

### 2.2 Backend API

The backend uses Node.js, TypeScript, and Express.

Responsibilities include:

- Authentication integration.
- Session verification.
- Authorization.
- Input validation.
- Catalog and service operations.
- Cart management.
- Checkout transactions.
- Order lifecycle enforcement.
- Media authorization.
- Administrative operations.
- Audit logging.

The backend must be deployed to an environment that supports the selected runtime and required database connections.

### 2.3 Database

The database uses PostgreSQL.

Responsibilities include:

- Persisting application data.
- Enforcing relational integrity.
- Enforcing unique and check constraints.
- Supporting transactional checkout.
- Preserving order and audit history.
- Supporting indexed queries.

The production database must be persistent. An ephemeral filesystem or temporary application storage must not be used as the primary database.

### 2.4 Object Storage

Production uploads use a private Cloudflare R2 bucket through the backend's S3-compatible storage adapter. Express remains the only upload and download gateway.

## 3. Environment Strategy

Maintain separate environments.

| Environment | Purpose | Data |
| --- | --- | --- |
| Local development | Feature development | Synthetic or local test data |
| Automated testing | Repeatable validation | Isolated test data |
| Production | Public application | Real application data |

Each environment must have independent configuration.

Production secrets must never be copied into local example files, committed to Git, or exposed through frontend environment variables.

## 4. Selected Deployment Architecture

The production topology is:

- Netlify hosts the React + TypeScript + Vite frontend.
- Render hosts the Node.js + TypeScript + Express API.
- Neon hosts the PostgreSQL database.
- Cloudflare R2 provides one private object bucket accessed through the Express storage adapter.
- Express sessions and the PostgreSQL session store remain the authentication system.

Netlify proxies same-origin `/api/*` and `/media/*` requests to Render before the SPA fallback. The browser does not receive database or R2 credentials and does not connect directly to either service.

Provider limits, current costs, data retention, and recovery options still require verification for the configured accounts. A frontend host does not provide the backend or database automatically, and zero cost is not guaranteed.

## 5. Frontend Deployment Requirements

The frontend deployment must support:

- Building the Vite application.
- Serving static assets over HTTPS.
- Same-origin `/api/*` and `/media/*` proxy rewrites to the Render API.
- SPA route fallback where required by the router.
- Environment-specific configuration.
- Deployment from the approved Git repository.
- Reproducible builds using the committed lockfile.

The frontend must not contain:

- Database credentials.
- Backend secret keys.
- Service-role credentials.
- Private signing keys.
- Production-only administrative secrets.

Any variable exposed to a browser must be treated as public.

Keep the proxy rules before `/* /index.html 200` so API and media requests never receive the SPA document. Replace `RENDER_SERVICE_HOSTNAME` in `public/_redirects` with the actual Render hostname before publishing the site.

## 6. Backend Deployment Requirements

The backend host must support:

- The selected Node.js version.
- The Express application runtime.
- HTTPS ingress or a trusted HTTPS proxy.
- Environment-variable configuration.
- Persistent outbound database connections or an approved pooling strategy.
- Application logs.
- Health checks.
- Graceful startup and shutdown where supported.
- Appropriate request and body-size limits.

The API must listen on the port provided by the hosting environment when required by the provider.

The server must not rely on a developer's local filesystem or machine remaining online.

For the approved Render deployment, build with `npm ci --include=dev && npm run build` and start with `npm start`. Set `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, and `WEB_ORIGIN` in the Render service. Render supplies `PORT`; the server must bind `0.0.0.0` and trust the single Render proxy hop in production. The startup handler must drain HTTP requests and close the PostgreSQL pool after SIGTERM or SIGINT.

If the Render service sleeps when idle, document the resulting cold-start behavior.

## 7. PostgreSQL Deployment Requirements

The Neon production database must provide:

- Persistent storage.
- Supported PostgreSQL connectivity.
- Authentication and access controls.
- Encrypted connections where supported and required.
- Backup and recovery options appropriate to the project.
- Adequate storage and connection limits.
- A clear migration workflow.
- Monitoring or usage visibility.

For the existing Neon production database, verify the configured project, branch, database, and access controls before any approved production operation. Do not substitute local PostgreSQL for production checks.

Review and document:

- Whether its free tier is currently available.
- Storage limits.
- Connection limits.
- Inactivity or automatic-pause policies.
- Data retention and recovery options.
- Whether a payment method is required.
- Whether the project can remain operational without a paid upgrade.

Do not assume that a free database remains available forever or that an inactive project will remain online.

## 8. Neon PostgreSQL

The application uses the existing Neon PostgreSQL production branch through the standard `pg` driver. Configure the pooled `DATABASE_URL` for runtime and the direct `DATABASE_URL_UNPOOLED` for migrations. Both remain server-side; neither belongs in Netlify or a `VITE_` variable.

Neon provides PostgreSQL only in this architecture. The application does not use Neon Auth or Neon Object Storage. Local development continues to use the existing local PostgreSQL setup.

The migration command is a schema-changing operation. Review its target and migration plan and obtain approval before running it against Neon. Never reset or overwrite the production branch.

## 9. Authentication and Sessions

The application uses Express authentication with password hashes and PostgreSQL-backed sessions (`connect-pg-simple`). The implementation defines:

- How passwords are stored.
- How sessions are created and verified.
- How logout and session revocation work.
- How deactivated accounts are blocked.
- How roles are assigned and checked.
- How frontend authentication state is refreshed.
- How session secrets are configured and rotated.

The frontend must never be the sole authority for deciding whether a user is an administrator or seller.

Local and production environments use the same Express authentication and authorization behavior, with environment-specific database URLs and secure cookies over production HTTPS. Render's trusted proxy configuration supports secure cookies behind its HTTPS ingress.

## 10. Media Storage

Local development uses the filesystem adapter. Production uses a private Cloudflare R2 bucket through the AWS S3-compatible client. All uploads and downloads pass through Express; no public bucket access or direct browser upload is used.

The storage implementation defines:

- Allowed file formats.
- Maximum upload size.
- File validation.
- Object naming.
- Public versus private access.
- Ownership and access checks.
- Replacement and deletion behavior.
- Cleanup of orphaned files.
- Production storage credentials.

The current per-file upload limit is 12 MiB. The server validates the supported types and file signatures, assigns UUID object keys, checks ownership and publication visibility, and streams private files only after authorization. R2 credentials are configured only on Render.

## 11. Environment Variables

Maintain an `.env.example` file containing variable names and safe placeholder values only.

The current host configuration uses:

- Application environment.
- Netlify proxy rules; no browser database or storage credentials.
- Backend port.
- Database connection URL.
- `SESSION_SECRET` and exact `WEB_ORIGIN` on Render.
- Pooled `DATABASE_URL` and direct `DATABASE_URL_UNPOOLED` on the backend/migration environment as appropriate.
- `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_REGION` on Render only.
- Logging configuration.

The actual variable names must match the implementation.

Never commit a real `.env` file.

Never place a database URL, private key, or backend secret in a browser-exposed variable.

The application should fail clearly when required production configuration is missing rather than silently falling back to unsafe defaults.

## 12. CORS, Cookies, and HTTPS

Production configuration must explicitly define:

- Allowed frontend origins.
- Credential behavior.
- Cookie security attributes for the existing Express sessions.
- Secure transport requirements.
- CSRF protections appropriate to the authentication mechanism.
- Proxy trust configuration where needed.

Do not allow every origin with credentials enabled.

CORS is not a replacement for authentication or authorization.

The frontend uses same-origin Netlify rewrites for `/api/*` and `/media/*` to the Render service, with the SPA fallback listed after those proxy rules in `public/_redirects`. Replace `RENDER_SERVICE_HOSTNAME` in both proxy targets with the hostname assigned by Render before publishing the Netlify site. The proxy preserves the browser-visible origin, allowing the PostgreSQL-backed session cookie to remain `HttpOnly`, `Secure` in production, and `SameSite=Lax`. Set `WEB_ORIGIN` to the exact Netlify site origin. If direct cross-origin API access is used instead, configure one exact `WEB_ORIGIN`; use HTTPS domains under the same site so `SameSite=Lax` cookies can be sent, and do not use wildcard credentialed CORS.

The application applies in-memory per-process limits to registration, login, uploads, role applications, checkout, public catalog reads, media reads, and health checks. Authenticated uploads, role applications, and checkout also have per-user limits. These buckets reset on restart and are not shared across Render instances; they can be bypassed by distributed clients and do not guarantee DDoS protection. Do not add a shared paid store solely for this safeguard. Configure Cloudflare edge rate limiting/WAF separately if needed; this repository does not configure it. Edge controls can reduce abusive requests reaching Render, but application limits cannot prevent all traffic from reaching the infrastructure.

All client uploads pass through the authenticated Express API and server-generated UUID object keys; the private R2 bucket does not provide direct browser upload access. Private media downloads remain authorization-checked by Express. Application limits can reduce routine abuse, but they are not an R2 spending cap: the free allowance is not a hard limit, and budget alerts do not automatically stop spending. Review R2 usage and configure provider-side alerts separately.

HTTPS must be used for production user traffic and sensitive service connections.

## 13. Build and Deployment Pipeline

The deployment workflow should follow this sequence:

1. Pull the intended Git commit.
2. Install dependencies from the lockfile.
3. Run static analysis and type checking.
4. Run unit and integration tests.
5. Build the frontend and backend.
6. Review database migration changes.
7. Confirm the target environment.
8. Apply only the approved production migration, if required.
9. Deploy the application.
10. Run health checks and smoke tests.
11. Verify essential user journeys.
12. Record the deployed commit and actual results.

The pipeline must not silently execute destructive database operations.

Automatic deployment may be enabled only after the repository, deployment target, and migration behavior are understood.

## 14. Health Checks and Logging

The backend should expose an appropriate health endpoint.

Health checks must not reveal secrets or internal infrastructure details.

Operational logging should help diagnose:

- Application startup failures.
- Database connectivity failures.
- Request failures.
- Unexpected exceptions.
- Authentication integration failures.
- Storage failures.

Logs must not contain passwords, session tokens, secret keys, or unnecessary personal information.

Database health and application health should be distinguishable.

## 15. Backup and Recovery

Before accepting important production data, establish a recovery strategy appropriate to the selected provider.

Document:

- Available automated backups.
- Backup retention.
- Manual export procedures where appropriate.
- Recovery steps.
- Migration recovery.
- Expected data-loss limitations.

A database export is not proven usable merely because the export command succeeded. Recovery should be tested when practical.

Free-tier limitations must be clearly stated.

## 16. Deployment Verification

After deployment, verify:

- The frontend loads over HTTPS.
- Public routes and SPA navigation work.
- The frontend communicates with the intended API.
- The backend health endpoint responds.
- Database connectivity works.
- Authentication works in the deployed environment.
- Unauthorized access is rejected.
- Catalog data loads correctly.
- Cart and checkout operations behave correctly.
- Orders and status history persist.
- Media uploads and access controls work.
- No secrets are exposed to the browser.
- Logs contain no sensitive credentials.
- Critical workflows remain functional after a restart or redeployment.

A successful hosting build does not prove that the complete application works.

## 17. Rollback and Incident Response

For each production deployment, record:

- The deployed commit.
- The migration version.
- Configuration changes.
- Known limitations.
- Verification results.

If a deployment fails:

1. Identify the failing component.
2. Preserve relevant logs.
3. Prevent repeated destructive operations.
4. Roll back application code when safe.
5. Handle database changes according to the migration recovery plan.
6. Verify the restored application.
7. Document the cause and recovery.

Do not automatically reverse a database migration if doing so could destroy valid user data.

## 18. Cost and Free-Tier Policy

The initial target is zero monthly hosting cost.

Review the current selected providers' offerings against:

- Static frontend hosting.
- Persistent Node.js backend hosting.
- Managed PostgreSQL.
- Media storage.
- Build and deployment limits.
- Bandwidth and request limits.
- Sleep or inactivity policies.
- Backup and recovery capabilities.

If the selected combination cannot satisfy the requirements at zero cost, document the trade-offs before changing providers or enabling paid resources.

Do not enable paid resources or incur charges without explicit approval.

## 19. Deployment Completion Criteria

Deployment is considered complete only when:

- The production architecture is documented.
- All required providers have been selected and verified.
- Environment variables are configured securely.
- Database migrations are reviewed and applied through the approved process.
- Build and test results are recorded.
- Health checks pass.
- Essential user journeys are verified.
- Security controls are enabled.
- Backup and recovery limitations are documented.
- Actual costs and free-tier restrictions are disclosed.

## 20. Remaining Deployment Tasks

The providers and application architecture are selected. Before public launch:

- Replace the Render hostname placeholder in `public/_redirects` after the Render service exists.
- Configure the required environment variables on Render and keep all database and R2 credentials server-side.
- Configure the Netlify build and publish settings and verify the proxy rules precede the SPA fallback.
- Review backup, recovery, retention, resource limits, and current provider costs.
- Verify health checks, sessions, uploads, public media, and authorized private downloads against the hosted services.
- Apply no additional database migrations without a reviewed plan and explicit approval.

## 21. Safety Boundary

Writing deployment documentation does not authorize creating or modifying cloud resources.

Do not deploy, purchase services, enable paid resources, modify a remote database, change storage policies, or delete remote resources without explicit user approval.

## Local media storage limitation

Local development uploads remain on the developer's filesystem, may be lost with that machine, and are not migrated to production. Simulated checkout, wallet top-ups, refunds, and withdrawals do not move real money and must not be represented as settled external payments.

Development uploads continue to use the local filesystem under `UPLOAD_DIR`. Production uploads use a private Cloudflare R2 bucket; production startup fails if any required R2 setting is absent. Files are staged temporarily on the API host, validated, uploaded to R2 under their existing UUID filenames, then recorded in PostgreSQL without changing database paths. The four fixed demo SVGs remain ordinary public static assets and are not copied to R2.

### Cloudflare R2 setup

1. In the intended Cloudflare account, create one R2 bucket for marketplace uploads. Keep public access disabled; the application serves both public and private media through Express.
2. Create an R2 API token scoped to **Object Read & Write** for this bucket only. Do not use account-wide administrative credentials. Store the access key and secret only in Render's backend environment.
3. Configure these Render environment variable names: `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_REGION` (`auto`). Do not add them to Netlify or any `VITE_` variable.
4. Configure the Render service to use Node.js 20 or newer (the AWS S3 SDK runtime requirement) and set the existing backend environment variables.
5. Deploy the backend after setting the variables. Verify an authenticated upload returns its existing `/media/<UUID filename>` path, then verify permitted public media and an authorized private download through the Render/Netlify Express route. Also verify that an unauthorized private request returns not found. `/api/health` verifies PostgreSQL only; it does not perform an R2 health request.

The API uses conditional object creation so a UUID collision cannot overwrite an existing object. A disconnected upload aborts local/R2 transfer where supported and skips metadata if the transfer was confirmed but the request has already ended; ambiguous network cancellation can still leave an orphan object. PostgreSQL metadata writes are transactional, with best-effort object cleanup when the database rejects a write; object storage and PostgreSQL do not share an atomic transaction, so a crash or ambiguous network failure can leave an orphan or uncertain result. Existing local development uploads are not migrated automatically. Render's local disk is used only for temporary upload staging; it may be discarded after the request and must never be treated as persistent production storage.
