# API Contract — Mie Sukses Creative Marketplace

**Status:** Draft specification  
**Version:** 1.0  
**Frontend:** React + TypeScript + Vite  
**Database:** PostgreSQL  
**Development:** Local PostgreSQL without Docker  
**Payment:** Simulated checkout; no real payment processing

---

## 1. Purpose

This document defines the application's API contract between the frontend and trusted backend operations.

It specifies:

- Available operations and their responsibilities
- Request and response formats
- Authentication and authorization requirements
- Validation and business rules
- Error codes and failure behavior
- Transaction and idempotency requirements
- Pagination and search conventions

This document is a specification, not an implementation. Function names are logical operation names; the implementation may use database functions, server-side handlers, or a combination of both, provided the externally observable contract remains consistent.

## 2. API Design Principles

1. The frontend must not access privileged database operations directly.
2. Every protected operation must authenticate the caller and derive the caller's identity from a trusted authentication context.
3. The backend must never trust a caller-supplied user ID as proof of identity.
4. All input must be validated on the server.
5. Sensitive business rules must be enforced by the trusted backend and, where possible, database constraints.
6. Prices, totals, roles, account statuses, order statuses, and audit actors must not be accepted as authoritative client input.
7. Operations that change multiple related records must use database transactions.
8. Responses must use consistent structures and stable error codes.
9. The frontend must distinguish validation errors, authorization errors, conflicts, and unexpected server failures.
10. No API operation may silently modify the database schema or run migrations.
11. The local development API must not require a production or cloud database connection.
12. Supabase-specific authentication and Storage integrations must be isolated behind documented adapters.
13. No real payment gateway or payment credential is required for this MVP.

## 3. API Operation Naming

The names below are logical operation identifiers, not necessarily literal HTTP routes or PostgreSQL function names.

Implementation must document the mapping from each logical operation to its actual handler.

Operations are grouped by domain:

- Authentication
- Profile and account lifecycle
- Seller and administrator applications
- Service catalog
- Service management and media
- Cart and checkout
- Orders
- Administration and moderation

Use consistent response shapes and error codes across all groups.

## 4. Common Request and Response Contract

### 4.1 Successful response

Successful operations return the requested data or a documented result.

Conceptual example:

```json
{
  "data": {
    "id": "resource-identifier"
  },
  "error": null
}
```

A successful operation that has no response payload may return `data: null`.

### 4.2 Error response

Conceptual example:

```json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The supplied data is invalid.",
    "details": {
      "field": "display_name"
    }
  }
}
```

Rules:

- `code` is a stable machine-readable identifier.
- `message` is safe for display or logging after appropriate handling.
- `details` is optional and must not expose secrets or private data.
- Stack traces, SQL statements, credentials, and internal infrastructure details must not be returned to the frontend.
- The UI must not depend on exact English error-message text; it should use error codes.

The actual transport layer may use HTTP status codes, RPC responses, or a typed local adapter. It must preserve the same logical error semantics.

## 5. Authentication

### 5.1 `register`

Purpose: create a new buyer account.

Input:

- `email`
- `password`
- `display_name`

Validation:

- Email must be valid and normalized consistently.
- Password must satisfy the selected authentication provider's policy.
- Display name must contain 2–60 characters after trimming.
- New accounts always receive the `buyer` role.
- Caller-supplied role or account status fields must be rejected or ignored safely.
- Passwords must never be stored in `profiles`.

Success result:

- Account identifier
- Authentication/session result according to the selected adapter
- Basic profile information where available

The exact session behavior depends on whether email confirmation is enabled in the selected authentication environment.

### 5.2 `login`

Purpose: authenticate an existing user.

Input:

- `email`
- `password`

Success result:

- Authenticated session or session context
- Basic profile information

Failures must not disclose whether a particular email address exists.

### 5.3 `logout`

Purpose: terminate the current authenticated session.

Requirements:

- Operates on the current session.
- Must not accept another user's identity as the target.
- The UI must clear local authentication state after successful logout.
- Provider-specific session revocation behavior must be documented.

### 5.4 `get_current_session`

Purpose: determine the current authentication state.

Success result:

- Whether the session is authenticated
- Current user identifier when authenticated
- Current application profile and account status when available

This operation must not treat client-cached role information as authoritative authorization.

## 6. Profile and Account Lifecycle

### 6.1 `get_my_profile`

Authentication: required.

Input: none beyond the authenticated session.

Returns:

- `id`
- `display_name`
- `avatar_path`
- `role`
- `account_status`
- `created_at`
- `updated_at`

The response is limited to the authenticated user's own profile.

### 6.2 `update_my_profile`

Authentication: required.

Allowed input:

- `display_name`
- `avatar_path`

Rules:

- At least one permitted field must be supplied.
- Display name must satisfy the profile constraints.
- Avatar path must reference an authorized upload belonging to the current user.
- `role`, `account_status`, and profile ID cannot be changed through this operation.
- Unknown or protected fields must be rejected or safely ignored according to a documented validation policy.
- A deactivated account cannot use this operation.

Returns the updated profile.

### 6.3 `get_public_seller_profile`

Authentication: not required for public fields, unless the deployment requires otherwise.

Input:

- `seller_id`

Returns only:

- Seller ID
- Public display name
- Public avatar reference
- Published services, if requested by the corresponding catalog operation

Rules:

- The seller must have an active account and seller role.
- Do not expose email addresses, private profile fields, account metadata, or audit records.

### 6.4 `deactivate_my_account`

Authentication: required.

Input:

- Explicit confirmation
- Reauthentication if required by the chosen authentication provider

Rules:

- The operation must not hard-delete historical orders or audit records.
- The system must prevent the account from performing protected operations after deactivation.
- Existing active orders must be handled according to the approved account-lifecycle policy.
- Profile anonymization must follow `security.md`.
- Session revocation may require a trusted authentication-provider API.
- Media cleanup must be retry-safe and must not remove files still referenced by valid records.

Returns a deactivation result and any documented follow-up state.

## 7. Seller Applications

### 7.1 `submit_seller_application`

Authentication: required.

Input:

- `reason`
- `portfolio_url`

Validation:

- Reason: 30–2,000 characters after trimming.
- Portfolio URL: valid HTTP or HTTPS URL.
- Account must be active.
- Applicant must not already be a seller or administrator.
- Only one pending application per user is allowed.

Returns:

- Application ID
- Application status
- Submission timestamp

### 7.2 `get_my_seller_applications`

Authentication: required.

Returns only the authenticated user's applications.

Supports documented pagination and ordering by creation time.

### 7.3 `review_seller_application`

Authorization: active administrator.

Input:

- `application_id`
- `decision`: `approved` or `rejected`
- `review_reason`, when required by the final policy

Rules:

- Administrators cannot review their own applications.
- Only pending applications may be reviewed.
- Approval and the applicant's role change must be atomic.
- Every role change must create a role audit event.
- A repeated review of a completed application must return a documented conflict or idempotent result; it must not create duplicate role changes.

Returns:

- Application ID
- Final status
- Review timestamp

## 8. Administrator Requests and Role Management

### 8.1 `submit_admin_request`

Authentication: required.

Input:

- `reason`

Rules:

- Reason must contain 30–2,000 characters after trimming.
- The account must be active and eligible under the final admin-eligibility policy.
- Only one pending request per user is allowed.
- The caller cannot set their own role.

Returns the request ID and current status.

### 8.2 `review_admin_request`

Authorization: active administrator.

Input:

- `request_id`
- `decision`: `approved` or `rejected`
- `review_reason`, when required

Rules:

- The reviewer cannot be the applicant.
- Only pending requests may be reviewed.
- Approval and role change must be atomic.
- The operation must create a role audit event.
- The last active administrator must be protected against accidental demotion or deactivation.

### 8.3 `promote_user_to_admin`

Authorization: active administrator.

Input:

- `target_user_id`
- `reason`

Rules:

- The actor cannot promote themselves.
- The target must be eligible under the final role-transition policy.
- The reason is mandatory.
- The role change and audit event must commit together.
- The frontend cannot invoke this operation merely because a user claims to be an administrator.

Returns the target user's new role and the corresponding audit event identifier.

## 9. Service Catalog

### 9.1 `list_services`

Authentication: optional.

Input:

- `category_slug`, optional
- `search_query`, optional
- `sort`, optional
- `cursor`, optional
- `limit`, optional

Rules:

- Public results contain only published services from active sellers and active categories.
- Draft, suspended, and archived services are not visible in the public catalog.
- The server controls the maximum page size.
- Search text must be length-limited and safely parameterized.
- Sorting must use an allowlist of supported fields and directions.
- Pagination must be stable and deterministic.

Returns a page of service summaries and a next-page cursor when more results exist.

### 9.2 `get_service_detail`

Authentication: optional for published services.

Input:

- `service_id`

Rules:

- Public callers may access only published services.
- Owners may access their own service drafts and status information.
- Administrators may access additional details through authorized administrative operations.
- Private media must not be exposed merely because a service identifier is known.

Returns:

- Service ID
- Seller's public profile information
- Category
- Title
- Description
- Current price
- Thumbnail reference
- Authorized portfolio media references
- Creation and update timestamps

### 9.3 `search_services`

May be implemented as a specialized catalog query or as a documented variant of `list_services`.

Input:

- Search query
- Optional category
- Pagination parameters

The implementation must define supported searchable fields and matching behavior. Search must not bypass catalog visibility rules.

## 10. Seller Service Management

### 10.1 `create_service`

Authorization: active seller.

Input:

- `category_id`
- `title`
- `description`
- `price_idr`

The new service starts in `draft`.

The caller cannot assign a different seller ID or directly create a published service.

Returns the created draft service.

### 10.2 `update_service`

Authorization: owner of the service, with an active seller account.

Allowed fields:

- `category_id`
- `title`
- `description`
- `price_idr`

Rules:

- The caller cannot change the service owner.
- The caller cannot set arbitrary service status through this operation.
- Price must be a positive integer.
- Existing order snapshots must not change.
- A service's publish eligibility must be checked again when publishing.

Returns the updated service.

### 10.3 `publish_service`

Authorization: active owner-seller.

Input:

- `service_id`

Preconditions:

- Service belongs to the caller.
- Required fields are valid.
- Category is active.
- Seller account is active.
- A valid thumbnail object exists.
- Required media and service validations pass.

The operation must use a trusted backend or database validation mechanism to verify upload ownership and object existence.

Returns the published service or a stable validation error.

### 10.4 `archive_service`

Authorization: active owner-seller, subject to the final lifecycle policy.

Input:

- `service_id`

Rules:

- Archiving prevents new orders.
- Existing order history remains available.
- Media cleanup must not invalidate historical records or delete objects still in use.

Returns the resulting service status.

## 11. Service Media

Media operations must use a trusted upload and access strategy defined in `security.md`.

Logical operations:

- `request_avatar_upload`
- `confirm_avatar_upload`
- `request_service_thumbnail_upload`
- `confirm_service_thumbnail_upload`
- `request_portfolio_upload`
- `confirm_portfolio_upload`
- `remove_portfolio_image`
- `get_authorized_service_media`

Requirements:

- Enforce ownership and role authorization.
- Enforce the selected file-size and image-format limits.
- Store object paths in the database, not permanent public URLs.
- Use random object identifiers and authorized path prefixes.
- Prevent users from uploading into another user's or seller's namespace.
- Replace existing media only after the new upload is confirmed valid.
- Draft, suspended, and archived service media must remain private.
- Published service media may be delivered only through the approved public or signed-access strategy.
- Signed URL duration, if used, is five minutes.
- Cleanup operations must be safe to retry.

The implementation must not assume that a database transaction can roll back a completed Storage upload. Orphan cleanup must be handled explicitly.

## 12. Cart

### 12.1 `get_cart`

Authentication: required.

Returns the authenticated buyer's cart and its items, including:

- Cart ID
- Item ID
- Service ID
- Current service title and price
- Seller's public display name
- Service availability
- Cart update timestamp

The response must not expose another buyer's cart.

### 12.2 `add_cart_item`

Authentication: required.

Input:

- `service_id`

Rules:

- The caller must be an active buyer.
- The service must be published and belong to an active seller.
- The caller cannot add their own service.
- The same service cannot appear twice in one cart.
- The cart item has no quantity field.
- Re-adding an existing service returns a stable `CART_ITEM_EXISTS` conflict or an equivalent documented already-in-cart result.

Returns the created cart item and updated cart summary.

### 12.3 `remove_cart_item`

Authentication: required.

Input:

- `cart_item_id`

Rules:

- The item must belong to the authenticated buyer's cart.
- The operation must not permit removal from another user's cart.
- Missing or inaccessible items must be handled consistently without leaking private ownership information.

Returns the updated cart summary.

There is no quantity-update operation because quantity is always one.

## 13. Checkout

### 13.1 `checkout_cart`

Authentication: required.

Input:

- `idempotency_key`: UUID

The server determines the buyer and cart from the authenticated context.

The server must not accept client-authoritative values for:

- Buyer ID
- Seller ID
- Service price
- Order total
- Quantity
- Initial order status
- Checkout batch ownership

### Preconditions

- Caller is authenticated.
- Account is active and eligible to purchase.
- Cart contains at least one item.
- Each service is still published and orderable.
- Each seller and category remains active.
- The buyer is not ordering their own service.
- The idempotency key has not been reused for a different logical request.

### Atomic behavior

1. Check for an existing checkout result for the authenticated buyer and idempotency key.
2. If a matching completed request already exists, return the original result without creating new orders.
3. If the same key is associated with a different request fingerprint, return `IDEMPOTENCY_KEY_REUSED`.
4. Lock and validate the cart and relevant service state.
5. Read current prices from trusted database records.
6. Create one checkout batch.
7. Create exactly one order per cart item.
8. Set every order's quantity to `1`.
9. Snapshot the title and current price.
10. Create the initial order event for each order.
11. Remove the checked-out cart items.
12. Commit all changes together.

If any item fails validation, the entire transaction must roll back and the cart must remain intact.

### Response

Returns:

- Checkout batch ID
- Creation timestamp
- List of created orders
- Each order's ID, service title snapshot, seller ID, price snapshot, quantity, total, and status
- Aggregate total for display

The aggregate total is the sum of the created order totals and is computed by the server.

### Retry behavior

- The client generates one UUID for a deliberate checkout attempt.
- Network retries reuse that same UUID.
- A deliberate new checkout generates a new UUID.
- A retry must not produce duplicate batches or orders.
- The backend must define deterministic behavior for concurrent requests with the same key.
- The original result must remain retrievable even after the cart has been emptied.

## 14. Orders

### 14.1 `list_my_orders`

Authentication: required.

Input:

- Optional status filter
- Optional cursor
- Optional page size

Rules:

- Buyers see only orders where they are the buyer.
- Sellers see only orders where they are the seller.
- Administrators use a separate privileged administrative query.
- An authenticated user's buyer-party access is based on `buyer_id`, regardless of global role.
- The caller cannot change participant IDs in the query to obtain unauthorized data.

Returns a paginated list of orders.

### 14.2 `get_order_detail`

Authentication: required.

Input:

- `order_id`

Rules:

- Access is granted to the buyer or seller participating in that order, or an authorized administrator.
- The response uses immutable order snapshots for historical service details.
- Private data unrelated to the order must not be exposed.

Returns:

- Order details
- Buyer and seller public identifiers
- Status and timestamps
- Permitted order events
- Relevant historical service snapshots

### 14.3 `transition_order`

Authentication: required.

Input:

- `order_id`
- `target_status`
- `reason`, required for seller rejection

Allowed transitions:

- `paid` → `accepted` by the order seller
- `paid` → `under_dispute` by the order seller with a required reason
- `accepted` → `in_progress` by the seller
- `work_submitted` → `completed` by the order buyer
- `work_submitted` → `under_dispute` by the order buyer or seller through the matching complaint operation

Rules:

- Only documented transitions are allowed.
- Actor identity comes from the authenticated context.
- The backend verifies account status and the authenticated user's buyer or seller relationship to this order. Global role labels do not grant order-party actions.
- Order status and corresponding event must be written atomically.
- Transition timestamps must be generated by the trusted backend.
- Terminal orders cannot be reopened.
- `cancelled` is retained for historical reads and is not an ordinary transition.
- Direct client updates to order status are prohibited.

Returns the updated order and the newly created event.

### 14.4 `submit_order_complaint`

Authentication: required. Input includes `order_id`, complaint type (`refund_request` or `payment_claim`), and a trimmed reason of 5–2,000 characters.

- Refund complaints are allowed only for the recorded buyer; payment complaints only for the recorded seller.
- Both require order status `work_submitted` and a confirmed simulated payment.
- The complaint, `under_dispute` status, and order event are recorded atomically.
- A new complaint cannot be submitted after the order enters `under_dispute` or reaches a terminal state.

An authorized Admin who is not a party may approve the refund (order becomes `refunded`), approve seller payment (order becomes `resolved`), or reject the complaint (the saved pre-dispute state is restored). Settlement and audit history are written atomically. No second-party dispute-response operation is currently defined.

## 15. Administration and Moderation

### 15.1 `list_seller_applications`

Authorization: active administrator.

Returns a paginated list of applications with permitted review information.

### 15.2 `list_admin_requests`

Authorization: active administrator.

Returns a paginated list of admin requests.

### 15.3 `list_users_for_admin`

Authorization: active administrator.

Returns only the fields necessary for user management.

Rules:

- This operation must not expose passwords, credentials, or authentication tokens.
- Sensitive personal information must be minimized.
- Role and account-status changes must use dedicated trusted operations.

### 15.4 `suspend_service`

Authorization: active administrator.

Input:

- `service_id`
- `reason`

Rules:

- Reason is mandatory.
- Service status changes and moderation audit events must be atomic.
- Suspension prevents new orders.
- Existing orders remain intact.

### 15.5 `restore_service`

Authorization: active administrator.

Input:

- `service_id`
- `reason`, when required by the final policy

Rules:

- The service must satisfy publication requirements.
- The seller and category must be eligible.
- Restoration must not bypass normal service validation.
- Moderation history must be preserved.

### 15.6 `archive_service_as_admin`

Authorization: active administrator.

Input:

- `service_id`
- `reason`

Rules:

- Archive action and audit record must be atomic.
- Archived services cannot receive new orders.
- Existing order history remains available.

## 16. Account and Seller Eligibility

All protected operations must check the current account status.

A deactivated account cannot:

- Publish or edit services
- Add or remove cart items
- Check out
- Accept or progress orders as a seller
- Submit new role applications
- Perform administrative actions

The final policy must define how deactivation interacts with existing active orders and pending applications.

The backend must not rely only on frontend route guards or cached profile roles.

## 17. Standard Error Codes

The implementation should use these stable error codes where applicable.

| Code | Meaning |
| --- | --- |
| `UNAUTHENTICATED` | No valid authenticated session |
| `FORBIDDEN` | Authenticated user lacks permission |
| `ACCOUNT_DEACTIVATED` | Account is no longer allowed to perform the operation |
| `VALIDATION_ERROR` | Input fails validation |
| `NOT_FOUND` | Resource does not exist or is not accessible |
| `CONFLICT` | Operation conflicts with current state |
| `CART_EMPTY` | No items available for checkout |
| `CART_ITEM_EXISTS` | Service is already in the cart |
| `SERVICE_UNAVAILABLE` | Service is not currently orderable |
| `SELLER_UNAVAILABLE` | Seller cannot accept new orders |
| `SELF_PURCHASE_NOT_ALLOWED` | Buyer is attempting to order their own service |
| `IDEMPOTENCY_KEY_REUSED` | Same key was used with a different logical request |
| `INVALID_ORDER_TRANSITION` | Requested transition is not permitted |
| `APPLICATION_ALREADY_PENDING` | An application of the same type is already pending |
| `APPLICATION_ALREADY_REVIEWED` | Application has already been reviewed |
| `LAST_ADMIN_PROTECTED` | Operation would remove the last active administrator |
| `ACTIVE_ORDERS_EXIST` | Lifecycle action is blocked by active orders |
| `MEDIA_INVALID` | Media fails validation |
| `MEDIA_ACCESS_DENIED` | Caller is not allowed to access the media |
| `RATE_LIMITED` | Request limit exceeded |
| `INTERNAL_ERROR` | Unexpected server-side failure |

The implementation may add codes when required, but must not repurpose an existing code to mean something materially different.

## 18. Validation and Error Handling

- Validate types, string lengths, UUID formats, allowed enum values, and required fields.
- Normalize input consistently.
- Use parameterized SQL and safe query builders.
- Do not concatenate untrusted input into SQL.
- Reject invalid price values and never trust client-computed totals.
- Return field-level validation details only where safe.
- Log unexpected failures server-side with a request correlation identifier.
- Never return secrets, session tokens, service-role keys, or database credentials.
- Make retry behavior explicit for every operation that can be safely retried.
- Do not automatically retry a non-idempotent operation unless it has a defined idempotency strategy.

## 19. Pagination and Sorting

List operations must use stable pagination.

Requirements:

- Enforce a documented maximum page size.
- Use deterministic ordering with a unique tie-breaker.
- Validate cursors rather than trusting arbitrary SQL or sort expressions from clients.
- Apply authorization and visibility filters before returning results.
- Avoid returning unbounded lists of services, orders, applications, or users.

The exact cursor encoding and catalog search implementation will be documented during architecture finalization.

## 20. Security Requirements

- Frontend route guards are for user experience, not security enforcement.
- Every protected operation performs backend authorization.
- User roles must come from trusted database state.
- Order ownership must be checked on every read and mutation.
- Client-supplied actor IDs must never determine audit attribution.
- Direct client writes to orders, order events, role audit events, and moderation events are prohibited.
- Storage authorization is defined by `security.md`.
- Privileged secrets must never be included in browser bundles.
- Supabase service-role credentials, if used by a trusted backend, must remain server-side.
- Any `SECURITY DEFINER` function must use a safe search path and minimal execute grants.
- RLS and database grants must be tested separately from frontend authorization.

## 21. Local and Supabase Compatibility

The local implementation must expose the same logical business operations as the target Supabase deployment.

The implementation must isolate provider-specific behavior, including:

- Authentication and session creation
- Current-user identity context
- Storage upload and signed URL issuance
- Session revocation
- Deployment-specific authorization context

Local PostgreSQL alone does not provide Supabase Auth or Storage. The local development adapter must be explicitly designed and documented before authentication-dependent implementation begins.

Tests that require actual Supabase JWT claims, RLS, or Storage policies must be identified as integration tests and must not be falsely reported as passed by local-only tests.

No production or cloud database connection is required to run local API and database tests.

## 22. Required Tests

At minimum, test the following:

1. Unauthenticated requests cannot access protected operations.
2. A buyer cannot read another buyer's cart or private profile.
3. A buyer cannot order their own service.
4. A repeated cart item is rejected without duplication.
5. A checkout creates exactly one order per cart item.
6. Every order has quantity exactly one.
7. Multi-seller checkout produces multiple orders under one batch.
8. Failed checkout rolls back all order creation and preserves cart contents.
9. A retry with the same idempotency key returns the original result.
10. Reusing the key with a different fingerprint fails.
11. A client cannot choose order prices, totals, or statuses.
12. A seller cannot transition another seller's order.
13. Terminal order states cannot be reopened.
14. A deactivated account cannot perform protected actions.
15. Unauthorized users cannot approve applications or change roles.
16. Role changes and audit records commit atomically.
17. Draft and suspended service media remain private.
18. Unexpected errors do not expose credentials or internal SQL details.

## 23. Implementation Boundary

This document does not authorize execution of SQL, creation or application of migrations, connection to Supabase Cloud, deployment, or changes to external resources.

Implementation must wait until the architecture, database, and security contracts have been reconciled and the user explicitly authorizes the relevant stage.

Any deviation from these contracts must be documented, justified, tested, and approved before implementation.

## 24. Current Express Compatibility Notes

The current local Express implementation retains its existing routes and request shapes. These additive response fields are available to the frontend:

- `POST /api/checkout` returns `subtotal`, `tax`, and `totalPayable`. `aggregateTotal` remains as a compatibility alias for the payable amount. A retry returns the persisted payment amount; it does not rewrite historical checkout records.
- `GET /api/orders/:id` returns `payment_amount`, `payment_subtotal`, and `payment_tax`. Buyer email is returned only to that order's buyer. The buyer phone snapshot is returned only to that order's buyer and seller; an unrelated administrator receives neither contact field.
- `GET /api/sellers/:id` returns display name, avatar, portfolio, and published services; it omits contact phone because the current schema has no public-phone consent field and buyer checkout can populate the shared phone value.
- `GET /api/seller/applications/mine` includes `application_type`, status, review timestamp and note, plus the reviewing administrator's display name and avatar when available. New submissions allow one pending application across both role types. Approval grants only the requested role and closes other pending applications with preserved history.
- `POST /api/wallet/topups` creates an idempotent pending simulation session; `POST /api/wallet/topups/:sessionId/confirm` credits only after explicit confirmation, and `POST /api/wallet/topups/:sessionId/cancel` permanently cancels an unfinished session. Bank transfer and e-wallet confirmation use demo-only PIN `123456`; QRIS remains a non-payable simulation.
- `POST /api/checkout/:batchId/payment/cancel` invalidates the current unpaid attempt key without cancelling orders. `POST /api/checkout/:batchId/payment-method` updates that same pending checkout or settles it atomically from Me-Wallet. Confirmation and method changes reject stale attempt keys.
- `GET /api/admin/transactions` retains the transaction's own `status` and adds `linked_orders`, an array of associated `{ id, status }` records. Batch payment status and individual order status are distinct.
- `GET /api/order-issues/mine` includes recorded resolution, timestamp, reason, and limited administrator display identity for related order parties when available.
- `PUT /api/orders/:id/review` creates or replaces the authenticated buyer's integer rating (`1`–`5`) for an exactly `completed` order. The order detail response exposes `buyer_review_rating` only to that order's buyer.
- `GET /api/services`, `GET /api/services/:id`, and `GET /api/sellers/:id` return `rating`, `review_count`, and `completed_order_count`. Ratings average persisted reviews attached to completed orders; counts of completed orders include completed orders without reviews. No reviews returns `rating: null` and `review_count: 0`.

These notes describe the local Express implementation. The review fields require the additive `009_order_reviews.sql` migration; no existing records or historical amounts are rewritten.
