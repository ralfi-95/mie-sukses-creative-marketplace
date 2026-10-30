# Database Contract — Mie Sukses Creative Marketplace

**Status:** Draft specification for implementation  
**Database:** PostgreSQL  
**Development environment:** Local PostgreSQL, without Docker  
**Target backend:** Supabase PostgreSQL, after explicit approval  
**Version:** 1.0

---

## 1. Purpose and Scope

This document defines the authoritative database contract for Mie Sukses Creative Marketplace.

It specifies:

- Database entities and relationships
- Data types, constraints, and indexes
- User roles and account lifecycle
- Seller and admin applications
- Service catalog and media metadata
- Cart and checkout behavior
- Order lifecycle and immutable snapshots
- Moderation and audit records
- Transactional invariants
- Requirements for database functions and migrations

This document defines the intended behavior, not executable SQL. Implementation must wait until the architecture, API, and security contracts have been reviewed for consistency.

## 2. Non-Negotiable Rules

1. Development uses PostgreSQL installed locally without Docker.
2. No SQL is executed against Supabase Cloud without explicit user approval.
3. No old Supabase project, remote database, credentials, migration history, or configuration may be reused implicitly.
4. Database migrations must be version-controlled and applied in a deterministic order.
5. Client input is untrusted. Database functions must independently validate sensitive operations.
6. User roles and account statuses cannot be changed directly by ordinary users.
7. The application does not process real payments. Checkout creates simulated service orders only.
8. One cart may contain services from multiple sellers.
9. A cart may contain a particular service only once.
10. Every cart item produces exactly one order with quantity `1`.
11. A single checkout may create multiple orders under one checkout batch.
12. Checkout is atomic: either every item is checked out successfully, or no checkout changes are committed.
13. Retrying a checkout with the same idempotency key must not create duplicate orders.
14. Order prices and service titles are snapshotted at checkout and remain unchanged afterward.
15. Historical orders and audit records must survive account deactivation.
16. Sensitive order, role, moderation, and checkout mutations must pass through trusted database functions or an explicitly authorized backend.
17. Every exposed application table must have an intentional access policy; grants and row-level security must be reviewed together.

## 3. PostgreSQL Conventions

### 3.1 General conventions

- Use `uuid` for primary identifiers.
- Use `timestamptz` for timestamps.
- Store currency in integer rupiah (`bigint`), never floating-point values.
- Use `snake_case` for tables, columns, functions, indexes, and constraints.
- Use explicit foreign keys and named constraints.
- Use `NOT NULL` wherever absence is not a valid business state.
- Use database transactions for operations involving multiple related writes.
- Store uploaded file paths, not permanent public URLs.
- Avoid hard deletion of records referenced by orders or audit history.

### 3.2 Timestamp behavior

Tables that represent mutable business entities should generally have:

- `created_at timestamptz NOT NULL`
- `updated_at timestamptz NOT NULL`

Both default to the current transaction timestamp where appropriate.

`updated_at` must be maintained by a database trigger or another reliable server-side mechanism. Clients must not be trusted to provide authoritative timestamps.

Append-only event tables generally need `created_at` but do not require `updated_at`.

### 3.3 Identifiers

Application-generated UUIDs may be accepted where the API contract permits them. The database remains responsible for enforcing uniqueness and all relationships.

## 4. Enumerated Types

The implementation should define these enums, unless a documented technical reason justifies an equivalent constrained representation.

### `user_role`

- `buyer`
- `seller`
- `admin`

### `account_status`

- `active`
- `deactivated`

### `application_status`

- `pending`
- `approved`
- `rejected`

Used for seller and admin applications.

### `service_status`

- `draft`
- `published`
- `suspended`
- `archived`

### `order_status`

- `pending`
- `accepted`
- `in_progress`
- `completed`
- `rejected`
- `cancelled`

`cancelled` remains a historical state. The ordinary order-transition API does not create it.

## 5. Authentication and Profiles

### 5.1 Authentication ownership

The authentication provider owns credential storage and authentication sessions.

The application must not store passwords in its own profile table.

The target Supabase implementation will reference `auth.users`, but local PostgreSQL development must not assume that Supabase Auth tables exist locally. A documented development adapter or compatible local authentication setup is required.

### 5.2 `profiles`

Purpose: application-level identity, public display information, role, and account lifecycle.

Columns:

- `id uuid PRIMARY KEY`, referencing the authentication user identifier
- `display_name text NOT NULL`
- `avatar_path text NULL`
- `role user_role NOT NULL DEFAULT 'buyer'`
- `account_status account_status NOT NULL DEFAULT 'active'`
- `created_at timestamptz NOT NULL`
- `updated_at timestamptz NOT NULL`

Constraints:

- Trimmed display name must contain 2–60 characters.
- The avatar is stored as a Storage object path, not an arbitrary external URL.
- New accounts receive the `buyer` role.
- Registration metadata must never grant `seller` or `admin` privileges.
- Profile IDs cannot be reassigned.
- Account role and status are not editable through the ordinary profile-update operation.

Access rules:

- A user may read their own full application profile.
- A user may update only permitted fields such as `display_name` and `avatar_path`.
- Public seller information must be exposed through a restricted query, view, or function that returns only the seller identifier, display name, and avatar.
- Ordinary users must not be able to enumerate all private profiles.
- Deactivated accounts must be blocked from protected operations even if an old authentication session remains valid.

## 6. Seller Applications

### 6.1 `seller_applications`

Columns:

- `id uuid PRIMARY KEY`
- `user_id uuid NOT NULL`, referencing `profiles.id`
- `reason text NOT NULL`
- `portfolio_url text NOT NULL`
- `status application_status NOT NULL DEFAULT 'pending'`
- `reviewed_by uuid NULL`, referencing `profiles.id`
- `reviewed_at timestamptz NULL`
- `review_reason text NULL`
- `created_at timestamptz NOT NULL`

Rules:

- Application reason must contain 30–2,000 characters after trimming.
- Portfolio URL must use HTTP or HTTPS.
- A user may have at most one pending seller application.
- A user cannot review their own application.
- Only an authorized active administrator may approve or reject applications.
- An approved application and the associated role change must commit in the same transaction.
- A rejected application must include a recorded review outcome.
- Review history must not be editable by the applicant.
- A user who is already a seller or administrator cannot submit an ordinary seller application.

A partial unique index must enforce one pending application per user.

A database constraint must ensure that pending applications have no review timestamp or reviewer, while approved/rejected applications have the required review fields.

## 7. Administrator Requests and Role Auditing

### 7.1 `admin_requests`

Columns:

- `id uuid PRIMARY KEY`
- `user_id uuid NOT NULL`, referencing `profiles.id`
- `reason text NOT NULL`
- `status application_status NOT NULL DEFAULT 'pending'`
- `reviewed_by uuid NULL`, referencing `profiles.id`
- `reviewed_at timestamptz NULL`
- `review_reason text NULL`
- `created_at timestamptz NOT NULL`

Rules:

- The request reason must contain 30–2,000 characters after trimming.
- Only an active administrator other than the applicant may review a request.
- At most one pending request is allowed per applicant.
- Approval and role change must occur atomically.
- Administrator requests must not provide a path for users to assign themselves administrative privileges.
- Direct promotion by an existing administrator is permitted only through an authorized operation that records the reason and audit event.
- The last active administrator cannot be demoted or deactivated.
- An administrator cannot promote themselves.

The exact eligibility rule for a seller applying to become an administrator must be documented in the API and security contracts before implementation.

### 7.2 `role_audit_events`

Columns:

- `id uuid PRIMARY KEY`
- `actor_id uuid NOT NULL`, referencing `profiles.id`
- `target_user_id uuid NOT NULL`, referencing `profiles.id`
- `previous_role user_role NOT NULL`
- `new_role user_role NOT NULL`
- `reason text NOT NULL`
- `source text NOT NULL`
- `created_at timestamptz NOT NULL`

Constraints and behavior:

- `actor_id` must differ from `target_user_id`.
- `previous_role` must differ from `new_role`.
- `source` is restricted to approved role-change sources, such as application approval or direct administrator promotion.
- Role changes and corresponding audit events must be committed in the same transaction.
- Clients cannot directly insert, update, or delete audit events.
- Audit events are append-only.

## 8. Service Categories

### 8.1 `categories`

Columns:

- `id uuid PRIMARY KEY`
- `slug text NOT NULL UNIQUE`
- `name text NOT NULL`
- `is_active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL`

Seed categories:

| Slug | Display name |
| --- | --- |
| `video-foto-editing` | Video & Foto Editing |
| `fotografi` | Fotografi |
| `desain-grafis` | Desain Grafis |
| `ui-ux-design` | UI/UX Design |

Seed operations must be repeatable without duplicating categories.

Public catalog queries return only active categories. Deactivating a category must not destroy existing services or order history.

## 9. Services

### 9.1 `services`

Columns:

- `id uuid PRIMARY KEY`
- `seller_id uuid NOT NULL`, referencing `profiles.id`
- `category_id uuid NOT NULL`, referencing `categories.id`
- `title text NOT NULL`
- `description text NOT NULL`
- `price_idr bigint NOT NULL`
- `thumbnail_path text NULL`
- `status service_status NOT NULL DEFAULT 'draft'`
- `created_at timestamptz NOT NULL`
- `updated_at timestamptz NOT NULL`

Constraints:

- Title must contain 5–100 characters after trimming.
- Description must be nonempty after trimming and contain no more than 10,000 characters.
- Price must be greater than zero.
- A published service must have a valid thumbnail object path.
- A published service must belong to an active seller and active category.
- A seller cannot publish services while their account is deactivated.
- Only published services from active sellers and active categories are eligible for new orders.
- A service's seller ownership cannot be changed through ordinary client updates.
- Service status transitions must use authorized operations.
- Suspending, archiving, or unpublishing a service must not alter historical order snapshots.

### 9.2 `service_portfolio_images`

Columns:

- `id uuid PRIMARY KEY`
- `service_id uuid NOT NULL`, referencing `services.id`
- `storage_path text NOT NULL UNIQUE`
- `sort_order integer NOT NULL DEFAULT 0`
- `created_at timestamptz NOT NULL`

Rules:

- `sort_order` must be nonnegative.
- A service may contain no more than eight portfolio images.
- The image limit must be enforced by a trusted database function or another concurrency-safe mechanism.
- The seller may manage portfolio images only for their own service.
- Draft, suspended, and archived service media must not become publicly accessible.
- Historical orders must not depend on mutable portfolio metadata.

## 10. Cart

### 10.1 `carts`

Columns:

- `id uuid PRIMARY KEY`
- `buyer_id uuid NOT NULL UNIQUE`, referencing `profiles.id`
- `created_at timestamptz NOT NULL`
- `updated_at timestamptz NOT NULL`

Rules:

- Each buyer has one persistent cart.
- The cart can contain services from multiple sellers.
- Cart state persists between sessions.
- Successful checkout removes the checked-out items but retains the cart itself.

### 10.2 `cart_items`

Columns:

- `id uuid PRIMARY KEY`
- `cart_id uuid NOT NULL`, referencing `carts.id`
- `service_id uuid NOT NULL`, referencing `services.id`
- `created_at timestamptz NOT NULL`

Constraints:

- `UNIQUE (cart_id, service_id)`
- There is no quantity column.
- One service may appear only once in a given cart.
- The cart owner must be authenticated and authorized for every cart operation.
- A buyer cannot add their own service.
- Adding an already-present service must return a stable, understandable error or an already-in-cart result. It must not duplicate the item.
- Cart items are revalidated during checkout because service availability and prices can change.

## 11. Checkout Batches

### 11.1 `checkout_batches`

Columns:

- `id uuid PRIMARY KEY`
- `buyer_id uuid NOT NULL`, referencing `profiles.id`
- `idempotency_key uuid NOT NULL`
- `request_fingerprint text NOT NULL`
- `created_at timestamptz NOT NULL`

Constraints:

- `UNIQUE (buyer_id, idempotency_key)`
- The fingerprint represents the canonical checkout request, including the relevant cart item identities and other fields that determine the request's meaning.
- A repeated key with the same request returns the previously created batch and orders.
- A repeated key with a different request fingerprint must fail with an explicit idempotency conflict.
- A new deliberate checkout must use a new idempotency key.

The database function must safely handle concurrent requests that use the same idempotency key.

## 12. Orders

### 12.1 `orders`

Columns:

- `id uuid PRIMARY KEY`
- `checkout_batch_id uuid NOT NULL`, referencing `checkout_batches.id`
- `buyer_id uuid NOT NULL`, referencing `profiles.id`
- `seller_id uuid NOT NULL`, referencing `profiles.id`
- `service_id uuid NOT NULL`, referencing `services.id`
- `service_title_snapshot text NOT NULL`
- `unit_price_snapshot_idr bigint NOT NULL`
- `quantity_snapshot smallint NOT NULL DEFAULT 1`
- `total_price_snapshot_idr bigint NOT NULL`
- `status order_status NOT NULL DEFAULT 'pending'`
- `created_at timestamptz NOT NULL`
- `accepted_at timestamptz NULL`
- `started_at timestamptz NULL`
- `completed_at timestamptz NULL`

Constraints:

- `buyer_id <> seller_id`.
- `unit_price_snapshot_idr > 0`.
- `quantity_snapshot = 1`.
- `total_price_snapshot_idr = unit_price_snapshot_idr`.
- The order's buyer must match the checkout batch's buyer.
- The service title, seller identity, and price must be copied from the validated service at checkout.
- Snapshot fields must not be modified after order creation.
- Orders are not hard-deleted as a normal application operation.
- Foreign-key deletion behavior must preserve historical order integrity.

There must be exactly one order per cart item checked out. A single batch may contain multiple orders, including orders for multiple sellers.

A quantity snapshot remains for explicit historical consistency even though its value is always one. The cart has no quantity field.

## 13. Order Events

### 13.1 `order_events`

Columns:

- `id uuid PRIMARY KEY`
- `order_id uuid NOT NULL`, referencing `orders.id`
- `actor_id uuid NOT NULL`, referencing `profiles.id`
- `from_status order_status NULL`
- `to_status order_status NOT NULL`
- `reason text NULL`
- `created_at timestamptz NOT NULL`

Rules:

- An initial event records the transition from no prior status to `pending`.
- Every later status change creates an event in the same transaction as the order update.
- Clients cannot directly insert, update, or delete order events.
- Participants may read events for their own orders.
- Authorized administrators may access events for moderation and dispute handling.
- Reasons are mandatory for administrative cancellations and other actions that require justification.

## 14. Moderation Events

### 14.1 `moderation_events`

Columns:

- `id uuid PRIMARY KEY`
- `admin_id uuid NOT NULL`, referencing `profiles.id`
- `service_id uuid NOT NULL`, referencing `services.id`
- `action text NOT NULL`
- `reason text NOT NULL`
- `created_at timestamptz NOT NULL`

Allowed actions:

- `suspend`
- `restore`
- `archive`

Rules:

- The actor must be an active administrator.
- Reasons must contain 3–2,000 characters after trimming.
- Moderation changes and audit events must commit atomically.
- Clients cannot modify or delete moderation history.

## 15. Relationships and Deletion Rules

The implementation must preserve referential integrity.

- A profile referenced by orders or audit history must not be hard-deleted.
- A service referenced by an order must not be hard-deleted.
- A category referenced by services must not be hard-deleted while referenced.
- Cart items may be removed when the buyer removes a service or checkout succeeds.
- Portfolio metadata must not be cascade-deleted in a way that destroys required historical evidence.
- Account deletion means deactivation and privacy-aware profile anonymization, not destructive deletion of orders or audit records.
- Exact anonymization fields and permitted retained data must be defined in the security contract.
- Authentication-session revocation may require an authorized backend/Auth API operation; a profile status change alone is insufficient.

Use `ON DELETE RESTRICT` for records whose deletion could invalidate business history unless an explicit, reviewed exception is documented.

## 16. Checkout Transaction Contract

The `checkout_cart` operation must execute as one transaction.

### Preconditions

- Caller is authenticated.
- Caller profile is active; global role does not prevent the caller from becoming the order buyer.
- Cart belongs to the caller.
- Cart contains at least one item.
- Idempotency key is valid.
- Every service is published, belongs to an active seller, and uses an active category.
- Buyer is not ordering their own service.
- Current prices and service snapshots are read from trusted database records.

### Transaction steps

1. Derive the buyer ID from the authenticated context.
2. Validate the idempotency key and request fingerprint.
3. Return the prior result if the same key and request are already committed.
4. Lock the relevant cart and validate its current contents.
5. Lock or otherwise concurrency-safely validate relevant service and seller state.
6. Create the checkout batch.
7. Create exactly one order per cart item.
8. Set each order's quantity snapshot to `1`.
9. Set each total equal to the unit price snapshot.
10. Create an initial `pending` order event for every order.
11. Remove the checked-out cart items.
12. Commit the transaction.
13. Return the checkout batch and its created orders.

### Failure behavior

- If any item is invalid, the entire transaction rolls back.
- No partial batch or partial set of orders may remain.
- Cart items remain if checkout fails.
- A retry must not duplicate orders.
- A checkout with the same key but different request fingerprint fails.
- Client-provided prices, seller IDs, order totals, or statuses are never trusted.

A concurrent attempt to change a service or seller state must not bypass checkout validation.

### 16.1 Simulated payment attempts

- A checkout payment remains `awaiting_payment` while its orders remain `pending`. Changing the simulated method updates that checkout payment only; it must not create another batch or order.
- Cancelling an unfinished checkout attempt rotates its payment attempt key. Confirmation and method changes must present the current key, so a stale screen cannot settle after cancellation. Cancellation leaves the checkout and orders unpaid.
- `wallet_topup_sessions` records an authenticated user's simulated top-up amount and selected method before confirmation. Only an `awaiting_payment` session can complete or cancel. These outcomes are mutually exclusive, and only completion creates a completed `top_up` wallet transaction.
- Pending or cancelled top-up sessions do not contribute to wallet balance. Replayed confirmation of a completed session returns its original wallet transaction; cancelled sessions cannot be confirmed.
- Checkout wallet payment and top-up confirmation lock their authoritative records and write the wallet transaction, payment state, order events, and audit data atomically.

## 17. Order State Machine

Normal transitions:

- Initial creation → `pending`
- `pending` → `paid` after checkout payment confirmation
- `paid` → `accepted` or `under_dispute` by the recorded seller
- `accepted` → `in_progress` by the seller
- `in_progress` → `work_submitted` by the seller
- `work_submitted` → `completed` by the recorded buyer
- `work_submitted` → `under_dispute` through a buyer refund complaint or seller payment complaint

Order actions are authorized from `buyer_id` and `seller_id`; a global role does not grant party permissions. Admins cannot act as a party on an unrelated order. `cancelled` remains a historical state and has no normal user transition.

Terminal states:

- `completed`
- `rejected`
- `cancelled`

No transition may reopen a terminal order.

The database function must verify actor identity, role, account status, participant relationship, and permitted transition. Clients cannot directly update order status or transition timestamps.

## 18. Price and Snapshot Integrity

- Prices use integer IDR values.
- A service price must be positive.
- Checkout uses the current validated price, not a value submitted by the client.
- Order snapshots remain unchanged if the seller later changes the service title or price.
- `total_price_snapshot_idr` must equal `unit_price_snapshot_idr` because quantity is always one.
- Historical order details must remain available when a service is archived or a seller account is deactivated.

## 19. Indexing Requirements

The implementation should provide indexes for common filtering and joins, including:

- Profiles by role and account status where operationally useful.
- Seller applications by user, status, and creation time.
- Admin requests by user, status, and creation time.
- Services by seller, status, category, and creation time.
- Published service catalog queries by category and creation time.
- Portfolio images by service and sort order.
- Cart lookup by buyer and cart items by cart ID.
- Checkout batch lookup by buyer and idempotency key.
- Orders by buyer and creation time.
- Orders by seller and status.
- Orders by checkout batch.
- Order events by order and creation time.
- Moderation events by service and creation time.
- Role audit events by target user and creation time.

Unique constraints and partial indexes must enforce business invariants, not merely improve performance.

The exact indexes for text search depend on the search implementation selected in the architecture and API contracts.

## 20. Required Trusted Database Operations

Sensitive operations must be implemented as reviewed database functions or explicitly authorized backend operations.

Required capabilities include:

- Create and update a profile's permitted fields.
- Submit and review seller applications.
- Submit and review admin requests.
- Promote a user to admin with audit logging.
- Create, edit, publish, suspend, restore, and archive services.
- Validate and manage service portfolio metadata.
- Read and modify the authenticated buyer's cart.
- Execute atomic, idempotent checkout.
- Read permitted orders and order history.
- Transition order status and append order events.
- Moderate services and append moderation events.
- Deactivate an account and perform the authorized cleanup/session-revocation workflow.

Function names and detailed input/output shapes belong in `api-contract.md`.

Trusted functions must derive actor identity from the authenticated context, never from a caller-supplied actor ID. `SECURITY DEFINER` functions, if used, must have a safe search path, fully qualified object references, minimal grants, and explicit authorization checks.

## 21. Local PostgreSQL Compatibility

Local development must use PostgreSQL without Docker.

Because local PostgreSQL does not automatically provide Supabase Auth, Storage, JWT context, or Supabase-specific roles and functions:

- Database schema and business constraints must remain portable wherever practical.
- Supabase-specific integration must be isolated from portable business rules.
- The local development setup must document how authentication identity and authorization context are simulated.
- Tests that depend on real Supabase Auth, Storage, or RLS must be identified separately from local database tests.
- No production or cloud connection string may be required to run local schema tests.
- Migration files must not silently target a remote database.

The local adapter must not be treated as proof that Supabase RLS and Storage policies are correct. Those require separate integration tests before cloud deployment.

## 22. Migration and Testing Requirements

Migration files must be ordered, reviewed, and repeatable where applicable. Seed data must not create duplicate categories on repeated execution.

The planned migration sequence is:

1. Foundation, enums, profiles, and categories.
2. Applications, role management, and role audit.
3. Services, portfolio metadata, and catalog indexes.
4. Cart, checkout batches, orders, and order events.
5. Moderation, account lifecycle, and cleanup workflows.
6. RLS, grants, Storage policies, and security tests for the approved target environment.

Required tests include:

- A buyer cannot access another buyer's private cart.
- A buyer cannot order their own service.
- A cart cannot contain the same service twice.
- A cart item has no quantity field.
- Every created order has quantity exactly one.
- Multi-seller checkout creates one order per cart item.
- A checkout failure leaves no partial orders and does not empty the cart.
- Repeated checkout with the same key does not create duplicate orders.
- Reusing an idempotency key with a different fingerprint fails.
- Order snapshots remain unchanged after service edits.
- Unauthorized users cannot modify roles or order statuses.
- Inactive sellers cannot receive new orders.
- Draft and suspended service media remain private.
- The last active administrator cannot be demoted or deactivated.
- Account deactivation preserves order and audit history.

## 23. Open Implementation Dependencies

The following details must be finalized in the API, security, and architecture contracts before implementation:

- Exact local authentication adapter and how identity context is simulated.
- Seller/admin application eligibility rules.
- Exact permitted service and order transitions.
- Session revocation and media cleanup implementation.
- Catalog search and pagination implementation.
- Exact RLS policies and grants for the approved Supabase target.
- Whether quantity is permanently excluded or retained only as an order snapshot. The current business decision is that quantity is always one.

## 24. Implementation Boundary

This document is a specification only.

Do not execute SQL, create or apply migrations, connect to Supabase Cloud, change remote projects, or modify credentials based solely on this document.

Implementation may begin only after the user approves the complete blueprint and explicitly authorizes the relevant local development steps.

Any proposed change to these rules must be documented, reviewed for impact on the API and security contracts, and approved before implementation.

## 25. Order Reviews

The additive `order_reviews` table stores one optional integer rating per order. `order_id` is both the primary key and a foreign key to `orders.id`; `rating` is constrained to `1` through `5`. Creation and replacement are allowed only for the authenticated order buyer while the order status is exactly `completed`. Aggregates include ratings only from completed orders, while completed-order counts include all completed orders whether rated or not. No review text or buyer contact data is exposed through aggregate responses.
