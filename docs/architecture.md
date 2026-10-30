# System Architecture — Mie Sukses Creative Marketplace

**Status:** Current implementation and deployment architecture
**Project:** Mie Sukses Creative Marketplace  
**Architecture principle:** Local development with a modular application and explicit production providers.

## 1. Architecture Goals

The system must:

1. Run locally without requiring hosted services.
2. Keep application source code, database schema, and migration files under version control.
3. Separate frontend presentation, backend business logic, and database persistence.
4. Keep authentication and storage responsibilities within the backend and storage adapter boundaries.
5. Avoid unnecessary framework and infrastructure complexity.
6. Support a free-tier deployment where feasible.
7. Prevent accidental changes to remote resources without explicit approval.
8. Allow local testing before any cloud integration.
9. Keep business rules consistent between local and production environments.

The project must not depend on an undocumented remote database state.

## 2. High-Level Architecture

```text
Browser
   |
   v
Netlify: React + TypeScript + Vite
   | same-origin /api/* and /media/* proxy
   v
Render: Express + TypeScript API
   | pg pooled connection                 | private S3-compatible API
   v                                      v
Neon PostgreSQL                     Cloudflare R2
   |
   +---- Application data and PostgreSQL-backed Express sessions
   +---- Constraints, transactions, and audit records
      Direct PostgreSQL connection is reserved for approved migrations.
```

The frontend must communicate with the backend through a defined API contract.

The frontend must not connect directly to PostgreSQL, contain database credentials, or execute privileged database operations.

The backend is responsible for authentication verification, authorization, input validation, business rules, transaction boundaries, and controlled access to stored data.

## 3. Technology Stack

### Frontend

- React
- TypeScript
- Vite
- CSS using a documented design system
- React Router for client-side routing
- Zod for runtime validation of applicable frontend inputs and API responses
- Lucide React for interface icons
- Vitest and React Testing Library for frontend tests
- Playwright for end-to-end tests where practical

Dependencies must be added only when they solve an identified need. Avoid installing overlapping libraries that provide the same functionality.

### Backend

**Implemented: Node.js + TypeScript + Express.**

Responsibilities:

- Expose REST-style JSON endpoints.
- Validate request data.
- Authenticate requests through the existing Express session middleware.
- Enforce role and ownership rules.
- Execute business operations and database transactions.
- Generate trusted prices and order snapshots.
- Authorize media operations.
- Return consistent error responses.
- Record required audit events.

The backend uses `pg` with parameterized queries. Do not introduce a second backend framework or an ORM without an explicit architecture decision.

### Database

- PostgreSQL for local development.
- SQL schema and migrations stored in the repository.
- Explicit foreign keys, unique constraints, check constraints, and indexes.
- Transactions for operations that must succeed or fail atomically.
- Separate development and production database configurations.
- Local development uses PostgreSQL; production PostgreSQL is hosted by Neon.
- Runtime uses Neon's pooled `DATABASE_URL`; migrations use the direct `DATABASE_URL_UNPOOLED` connection.

The application uses ordinary PostgreSQL features and does not depend on provider-specific authentication or storage schemas.

### Authentication

Authentication uses the existing Express session implementation and PostgreSQL session store in both local and production environments.

The application must distinguish:

- Identity verification.
- Session management.
- Application profile data.
- Role and permission checks.

Neon Auth is not used. Keep identity, session management, profile data, and role checks in the existing Express application.

Do not implement a custom cryptographic protocol or password-hashing algorithm.

### Media storage

Media storage must use a defined adapter interface for:

- Upload authorization.
- File validation.
- Storage-key management.
- Authorized retrieval.
- Deletion and cleanup.

Local development uses the filesystem adapter under `UPLOAD_DIR`; production uses the private Cloudflare R2 bucket through the AWS S3-compatible API. Database paths remain `/media/<UUID filename>`; the server maps the filename to a storage key and serves every object through Express. The client receives no storage credentials or direct object URL. Public service media is served only when the service is published and its seller is active; avatars follow the active seller/current-avatar rule. Applications and deliverables are streamed only after the existing owner, reviewer, or order-access checks pass.

## 4. Application Layer Responsibilities

### Frontend layer

Responsible for:

- Pages and reusable components.
- Navigation and route presentation.
- Forms and client-side validation.
- Loading, empty, success, and error states.
- Search, filters, and catalog presentation.
- Cart interaction and checkout initiation.
- Displaying order states returned by the backend.

Not responsible for:

- Deciding trusted prices or totals.
- Granting roles.
- Authorizing access to other users' records.
- Directly changing order states in the database.
- Storing privileged secrets.
- Treating hidden buttons as security controls.

### Backend API layer

Responsible for:

- Parsing and validating requests.
- Identifying the authenticated actor.
- Checking account status, role, and resource ownership.
- Calling application services.
- Mapping expected failures to documented error codes.
- Preventing internal implementation details from leaking to clients.

Controllers or route handlers should remain thin. Business rules should live in testable application-service functions rather than being duplicated across routes.

### Application-service layer

Responsible for marketplace workflows, including:

- Profile updates.
- Seller application review.
- Service publishing and moderation.
- Cart operations.
- Checkout and idempotency.
- Order-state transitions.
- Account deactivation.
- Role changes and audit records.

Services must not trust prices, roles, ownership, or state transitions supplied by the frontend.

### Data-access layer

Responsible for:

- Parameterized database queries.
- Transaction handling.
- Mapping database records to application data.
- Applying database constraints.
- Avoiding accidental cross-user access.

Do not put authorization decisions exclusively in frontend code or assume that a successful database query proves the caller is authorized.

## 5. Repository Structure

The following is the proposed target structure. It describes the intended architecture, not files that have already been created.

```text
mie-sukses-creative-marketplace/
├── AGENTS.md
├── README.md
├── .gitignore
├── .env.example
├── package.json
├── docs/
│   ├── semua.md
│   ├── architecture.md
│   ├── requirements.md
│   ├── database-contract.md
│   ├── api-contract.md
│   ├── security.md
│   ├── ui-ux-specification.md
│   ├── testing-strategy.md
│   ├── migration-plan.md
│   ├── deployment.md
│   └── development-roadmap.md
├── apps/
│   ├── web/
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── api/
│       ├── src/
│       ├── tests/
│       └── package.json
├── packages/
│   └── shared/
│       └── src/
├── database/
│   ├── schema/
│   ├── migrations/
│   ├── seeds/
│   └── README.md
├── tests/
│   └── e2e/
└── scripts/
```

The final structure may be simplified if a monorepo creates unnecessary setup overhead. Any simplification must preserve the separation between frontend, backend, database assets, documentation, and tests.

`packages/shared` may contain genuinely shared types and schemas. It must not become a place for frontend-specific code, backend secrets, or duplicated business logic.

The application must not generate a second, conflicting source of truth for database schema or API contracts.

## 6. API Communication

The frontend communicates with the backend using JSON over HTTP.

Rules:

- Use the API contract in `docs/api-contract.md`.
- Use consistent response and error formats.
- Validate request payloads on the server.
- Use appropriate HTTP methods and status codes.
- Keep endpoint behavior documented.
- Do not expose raw database records without considering privacy and field-level access.
- Do not treat client-provided user IDs as authenticated identity.
- Avoid duplicating API business logic in the frontend.

The frontend uses relative `/api` and `/media` paths. Vite proxies them during local development; Netlify proxies them to Render in production before the SPA fallback. The deployed browser uses same-origin requests.

## 7. Local Development Environment

The intended local environment includes:

- Node.js.
- npm.
- PostgreSQL installed and running locally.
- A local development database and a separate test database.
- Environment files excluded from Git.
- Automated schema setup and migration scripts.
- Seed data for development and tests.

Docker is not required.

The setup instructions must document:

1. Required software and versions.
2. Database creation and local connection configuration.
3. Environment-variable setup.
4. Schema migration commands.
5. Seed-data commands.
6. Frontend and backend startup commands.
7. Test commands.
8. Reset procedures for disposable development data.

Database setup must be reproducible from repository-controlled SQL and scripts.

A migration must not silently depend on a change made manually to a developer's database.

## 8. Database and Migration Strategy

The repository is the source of truth for schema changes.

- Schema changes must be represented by version-controlled migration files.
- Migrations must have a defined order and unique identifiers.
- Migration execution must be tracked.
- Applied migrations must not be silently rewritten.
- Destructive migrations require explicit review.
- Test databases must be isolated from development data.
- Seeds must be repeatable where practical.
- Database reset commands must clearly identify which database they affect.

Local schema development and testing must work without network access to Neon.

Neon uses the repository's PostgreSQL migrations. Remote migration execution remains a separately approved deployment action.

Do not mix manual dashboard edits with untracked migration history.

## 9. Production Providers and Boundaries

The selected production topology is:

- Netlify hosts the static React + Vite frontend.
- Render hosts the Express + TypeScript API.
- Neon hosts PostgreSQL.
- Cloudflare R2 provides one private object bucket through the server-side S3-compatible storage adapter.
- Express sessions remain the authentication mechanism; Neon Auth is not used.

Netlify rewrites same-origin `/api/*` and `/media/*` requests to Render before applying the React SPA fallback. The browser never receives database or R2 credentials, and it never connects directly to either service.

Cloud provider configuration and remote data operations require explicit approval. Local development and tests must not silently switch to production resources.

## 10. Deployment Strategy

The deployment target uses free tiers where practical, while accounting for their limits. The selected components are:

- Frontend: Netlify.
- Backend: Render.
- Database: Neon PostgreSQL.
- Media: a private Cloudflare R2 bucket accessed only through the Express storage adapter.

Before enabling or changing hosted configuration, verify:

- Whether the free tier is currently available.
- Backend sleep or cold-start behavior.
- Database storage and connection limits.
- Environment-variable support.
- Build and deployment requirements.
- File storage limitations.
- Backup and recovery options.
- HTTPS and allowed-origin configuration.

Do not promise that the entire application will remain free indefinitely. Free-tier limits and provider policies may change.

A frontend deployment alone does not deploy the backend or database.

## 11. Configuration and Secrets

Use environment variables for environment-specific configuration.

Provide safe placeholders in `.env.example`.

Never commit:

- Database passwords.
- Production connection strings containing credentials.
- Authentication signing secrets.
- Neon database credentials or Cloudflare R2 credentials.
- Private storage credentials.
- Real user credentials or production data.

Frontend-exposed environment variables must contain only values intended to be public.

Use separate configurations for local development, automated tests, and production.

## 12. Testing and Quality Gates

Before a feature is considered complete, verify the applicable layers:

1. Unit tests for business rules.
2. Database tests for constraints and transactions.
3. Authorization tests for ownership and role boundaries.
4. API tests for request and response behavior.
5. Frontend tests for key interactions and states.
6. End-to-end tests for important user journeys.
7. Build and static-analysis checks.

Report the commands executed and their actual results.

A successful frontend build does not prove that database operations, authorization, or checkout work correctly.

A test that was not executed must be reported as not run.

## 13. Architecture Decision Rules

Any major change to this architecture must be recorded in the relevant documentation before implementation.

Changes requiring review include:

- Replacing the backend framework.
- Changing authentication providers.
- Changing database access libraries.
- Adding a new hosted service.
- Changing role or ownership enforcement.
- Changing transaction boundaries.
- Changing storage visibility or access rules.
- Changing the deployment topology.

Prefer the simplest design that satisfies the documented requirements.

Do not add microservices, message brokers, complex caching, or unnecessary infrastructure for the initial marketplace.

## 14. Development and Hosted-Resource Boundaries

- Keep local development and tests isolated from production resources by default.
- Do not run migrations, execute production SQL, or modify hosted resources without approval for the specific operation.
- Do not reuse credentials or configuration from unrelated projects.
- Do not claim that an unexecuted test or deployment succeeded.
- Inspect existing files and preserve uncommitted work before making changes.
