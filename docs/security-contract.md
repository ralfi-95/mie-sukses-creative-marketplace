# Security Contract — Mie Sukses Creative Marketplace

**Status:** Draft for review  
**Applies to:** Local development and eventual Supabase deployment  
**Authority:** This document defines security requirements. It does not authorize changes to any remote project.

## 1. Security Principles

1. Deny access by default.
2. Authentication identifies the user; authorization determines what that user may do.
3. A frontend role, route guard, hidden button, or client-submitted user ID is never sufficient authorization.
4. All prices, ownership, roles, account status, and order transitions must be validated by trusted backend logic.
5. Users may access only data explicitly permitted by their role and relationship to the resource.
6. Secrets must never be committed to Git or exposed in browser code.
7. Local development and Supabase deployment must implement equivalent business-security rules.
8. No remote database, authentication, storage, or project configuration may be changed without explicit user approval.

## 2. Authentication Boundary

The application must use an authentication adapter so local development does not depend on Supabase-specific system tables.

The adapter must expose the equivalent of:

- Register a user.
- Authenticate credentials.
- Retrieve the current authenticated identity.
- Validate a session or access token.
- Revoke or terminate a session where supported.
- Initiate account deactivation and associated session revocation.

### Local environment

- Use a documented local authentication implementation.
- Never pretend that Supabase's `auth.users`, session service, or Storage exists in a plain local PostgreSQL installation.
- Store password hashes only through an established password-hashing library or authentication implementation.
- Never store plaintext passwords, reversible passwords, or password values in application logs.
- Do not implement a custom password-hashing algorithm.
- Use a modern password-hashing algorithm supported by the chosen authentication library, such as Argon2id where available.

### Supabase environment

- Use Supabase Auth through the approved adapter.
- Do not create a second password store in `profiles`.
- Do not trust a user ID supplied in request data when a verified session can provide the identity.
- Never expose the Supabase service-role key to the frontend.

The exact local authentication library and production adapter must be documented in `architecture.md` before implementation.

## 3. Roles and Authorization

The application supports three roles:

- `buyer`
- `seller`
- `admin`

### Buyer

A buyer may:

- Read published services and public seller profiles.
- Manage their own profile and active cart.
- Read their own orders and related order events.
- Submit seller applications and admin-access requests, subject to eligibility rules.
- Perform buyer-authorized order transitions.

A buyer must not:

- Read another buyer's private profile, cart, or orders.
- Change their own role or account status.
- Set prices, seller IDs, order ownership, or order status through client input.
- Access private service drafts, moderation records, or role-audit records.

Order-party authorization is based on the order's `buyer_id` and `seller_id`, not the caller's global role. A seller or Admin may exercise buyer actions for an order they purchased. Admin privileges never grant buyer or seller actions on an unrelated order.

### Seller

A seller may:

- Perform buyer permissions unless a specific rule restricts them.
- Create and manage their own services.
- Read orders associated with their own seller account.
- Accept or reject eligible pending orders.
- Move accepted orders to `in_progress`.
- Access media belonging to their own services, subject to service visibility rules.

A seller must not:

- Edit another seller's services.
- Change their role, approval status, or account status.
- Read orders belonging to unrelated sellers.
- Change historical order snapshots or directly rewrite order events.
- Access private media owned by another seller without an explicit authorization rule.

### Admin

An admin may perform documented administrative operations, including:

- Review seller applications and admin-access requests.
- Moderate services and accounts.
- Perform authorized role changes.
- Review relevant moderation and role-audit records.

Admin access must be checked by trusted backend logic. Administrative operations must not rely on a frontend-only role check.

Sensitive operations must record the acting admin, target resource, action, timestamp, and required reason or decision details.

The system must prevent an admin from removing or demoting the last active admin. An admin must not promote themselves through the ordinary promotion workflow.

## 4. Account Status and Role Changes

- Only active accounts may perform ordinary authenticated operations.
- Deactivated accounts must be denied new protected operations.
- A role change must be performed through an authorized backend operation.
- Every role change must create a corresponding `role_audit_events` record in the same transaction where feasible.
- Application approval and role assignment must be atomic: the application must not be marked approved if the associated role change fails.
- Client-submitted role values must never be accepted as proof of authorization.
- Account deactivation must not silently erase order history or audit records.
- Session revocation must use the selected authentication adapter's supported mechanism.

## 5. Data Access Rules

### Public data

Unauthenticated visitors may read only:

- Published services belonging to eligible active sellers.
- Public seller display names and avatar references.
- Active marketplace categories.

Public responses must not expose email addresses, authentication identifiers unless required, private application reasons, internal moderation notes, or other private profile fields.

### Private user data

- A user may read and update only their own private profile fields.
- A buyer may read only their own cart and cart items.
- A buyer may read only their own orders and order events.
- A seller may read orders assigned to them as the seller.
- Application submitters may read their own applications.
- Only authorized admins may read all applications, moderation records, and role-audit records.

### Historical records

Order snapshots and order events must remain protected and immutable to ordinary users.

Hard deletion must not be used to bypass access restrictions or erase records required for marketplace history and auditing.

## 6. Server-Side Validation and Transaction Safety

The trusted backend must validate:

- Authentication and active account status.
- Role and resource ownership.
- Input types, lengths, ranges, and allowed enum values.
- Service publication and seller eligibility before checkout.
- Current service price from the database.
- Buyer/seller identity and self-purchase restrictions.
- Valid order-state transitions.
- Idempotency behavior for checkout retries.
- Admin-only operations and last-admin protection.

Client-supplied prices, totals, role names, account statuses, seller identities, order states, storage paths, and moderation decisions must not be trusted.

### Transaction requirements

The following operations must use database transactions or an equivalent atomic mechanism:

- Seller application approval and role assignment.
- Admin-access approval and role assignment.
- Checkout batch and order creation.
- Cart clearing after successful checkout.
- Order status changes and corresponding order-event creation.
- Moderation changes and their audit records.
- Role changes and role-audit records.

A failed transaction must not leave partially created orders, missing audit events, or inconsistent role/application states.

## 7. PostgreSQL Row-Level Security (RLS)

### Supabase deployment

RLS must be enabled for every exposed application table unless a documented, reviewed exception exists.

Policies must follow least privilege and must be reviewed against actual query patterns.

Important rules:

- Public users may select only explicitly public marketplace data.
- Authenticated users may access only rows they are authorized to access.
- Users must not assign themselves privileged roles or alter protected status fields.
- Sellers may manage only their own service records.
- Buyers may access only their own carts and buyer-side order data.
- Sellers may access only orders assigned to their seller identity.
- Audit and moderation records must not be writable by ordinary clients.
- Privileged operations must execute through an explicitly authorized trusted backend path.
- Service-role credentials must never be used in browser requests.

Do not assume that hiding a table from the frontend, removing a UI button, or using an unlisted route provides database security.

### Local PostgreSQL

Plain PostgreSQL does not automatically provide Supabase's `auth.uid()` function or Supabase Auth identity context.

Local authorization must not depend on an undefined `auth.uid()` function.

Before writing policies or queries, document how the local backend establishes a trusted user identity and how that identity is applied to database operations.

If local development uses a trusted application server as the security boundary, the server must enforce the same ownership and authorization rules. Database-level defenses should be added where practical.

The local and Supabase implementations must be tested for equivalent business permissions.

## 8. Storage and Upload Security

The application may support:

- Profile avatars.
- Service thumbnails.
- Seller portfolio images.

### Upload validation

For each upload, validate:

- Authenticated uploader and account status.
- Permission to upload for the target profile or service.
- Allowed image formats.
- Actual file content, not only the filename or claimed MIME type.
- File size limits.
- Image dimensions where relevant.
- Storage path ownership and destination.
- Per-resource image-count limits.

Reject executable files and unsupported file types. Never trust a client-provided storage path as proof of ownership.

The current upload limit is 12 MiB per file. Avatars and service thumbnails accept PNG, JPEG, or WebP; application documents and deliverables also accept PDF, DOC, and DOCX. The server checks MIME type and file signatures, including DOCX content. No image-dimension validation is currently implemented.

### Storage access

- Avatars may be publicly readable only if they are intentionally designated public.
- Published service thumbnails may be publicly readable.
- Draft, suspended, and archived service media must not be publicly readable unless a specific approved rule says otherwise.
- Portfolio media must follow the owning service's visibility and authorization rules.
- Users must not overwrite another user's media.
- Deleting or replacing a media record must not permit access to unrelated files.

Keep the production R2 bucket private. Do not issue public object URLs or redirects; Express is the only media gateway and must authorize private reads before opening an object. R2 credentials belong only in Render's server environment. Create R2 tokens scoped to object read/write on the one media bucket. Local development uses the filesystem adapter.

### Media metadata

Database records must store validated storage keys or paths rather than trusting arbitrary URLs supplied by users.

Avatar media metadata and `users.avatar_path` are written in one PostgreSQL transaction. If PostgreSQL rejects the metadata operation after a successful object upload, the application attempts to delete the new object. R2 and PostgreSQL cannot share a transaction: a process crash or ambiguous commit/network failure can still leave an orphan object or, rarely, a database reference whose object was compensated. Keep cleanup observable and reconcile these cases operationally; do not delete an object unless its key was newly created.

## 9. Input, Output, and Web Security

- Validate all inputs at the backend boundary.
- Use parameterized SQL queries or a safe query builder.
- Never concatenate untrusted input directly into SQL.
- Escape or safely render user-generated text to prevent cross-site scripting (XSS).
- Avoid rendering arbitrary user HTML.
- Use appropriate CSRF protection if authentication relies on cookies.
- Configure secure session cookies in production where applicable.
- Use HTTPS in production.
- Configure CORS to allow only intended origins.
- Apply reasonable rate limits to login, registration, application submission, upload requests, and other abuse-prone operations.
- Do not reveal stack traces, SQL details, tokens, or internal secrets in public error messages.
- Keep detailed diagnostic information in access-controlled server logs.

Search and filtering inputs must be bounded and validated to avoid excessive queries.

## 10. Secrets and Environment Configuration

- Commit `.env.example` with variable names and safe placeholders only.
- Keep real `.env` files out of Git.
- Never place database passwords, private API keys, service-role keys, signing secrets, or privileged tokens in frontend source.
- Never print secrets in terminal logs, tests, screenshots, or documentation.
- Rotate a secret if it is accidentally committed or exposed.
- Use separate credentials and projects for development and production.
- Do not reuse the old Supabase project configuration.
- Do not run remote migrations, SQL, storage changes, or project-management actions without explicit approval.

The exact environment-variable names must be defined in `architecture.md` and `deployment.md`.

## 11. Audit Logging

The system must preserve relevant audit history for:

- Role changes.
- Seller and admin-access application decisions.
- Service moderation actions.
- Administrative account actions.
- Order status transitions.

Audit entries must record the acting identity, target, action, timestamp, and required reason or metadata.

Ordinary buyers and sellers must not be able to edit or delete audit entries.

Do not log passwords, authentication tokens, service-role keys, or other secrets. Avoid logging unnecessary private user content.

## 12. Account Deactivation and Data Retention

Account deactivation must:

1. Deny new protected actions.
2. Revoke sessions using the selected authentication adapter where supported.
3. Prevent deactivated sellers' services from being newly ordered.
4. Preserve order snapshots and audit history.
5. Apply the documented policy for public profile and service visibility.
6. Make media cleanup retry-safe.

The exact behavior for accounts with active orders, retained profile information, and media deletion must be finalized in `requirements.md` and `database-contract.md` before implementation.

Do not claim that an account or all related data has been deleted if the system only deactivates access.

## 13. Testing Requirements

Security tests must cover at least:

- Unauthenticated access to protected operations.
- Buyer attempting seller-only operations.
- Seller attempting admin-only operations.
- A user attempting to read another user's private profile, cart, or orders.
- A seller attempting to edit another seller's services.
- A user attempting to self-assign an admin or seller role.
- A client attempting to alter price or order-state fields.
- A deactivated user attempting protected operations.
- A buyer attempting to access another buyer's order history.
- An unauthorized user attempting to access private media.
- Invalid upload type, size, or ownership.
- Checkout retries and duplicate-order prevention.
- Order transitions attempted by the wrong actor.
- Last-active-admin protection.
- Failure of an atomic operation without partial database changes.
- Local authorization behavior matching the intended production rules.

Tests must report actual results. A test must not be described as passing unless it has been executed and passed.

## 14. Implementation Gate

Before security-sensitive implementation begins:

1. Finalize the local authentication adapter.
2. Define the trusted backend boundary.
3. Finalize local and production storage adapters.
4. Resolve business rules referenced as pending in this document.
5. Define explicit RLS and storage policies for the actual schema.
6. Add tests for ownership and role enforcement.
7. Review environment-variable and secret-handling rules.

This contract is not authorization to deploy, execute remote SQL, apply migrations, modify Supabase resources, or change project settings.

Any remote operation requires explicit approval from the user before execution.
