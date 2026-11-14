# API Changes & Migration Notes

This document records all breaking changes, payload modifications, response shape alterations, new endpoints, and error code adjustments across implementation phases for the frontend integration.

---

## Phase 1: Critical Bug Fixes & State Normalization

### 1. Endpoint & Routing Fixes
* **`GET /users/me`**
  * **Status:** Resolved route collision bug.
  * **Details:** Previously, `GET /users/:userId` with `ParseIntPipe` matched first, resulting in `400 Bad Request` (`Validation failed (numeric string is expected)`). The route order was corrected so `GET /users/me` and `PATCH /users/me` now properly resolve the authenticated user's profile.

### 2. Task Assignment Payload
* **`POST /tasks/:taskId/assign`**
  * **Breaking Change:** Changed assignment input from query parameter to JSON request body.
  * **Previous:** `POST /tasks/:taskId/assign?assignTo=123`
  * **New:** `POST /tasks/:taskId/assign`
    ```json
    {
      "userId": 123
    }
    ```
  * **Content-Type:** `application/json`

### 3. Task Response Schema Updates
* **`TaskResponseDto`**
  * **Removed Property:** `endedAt` (nonexistent in domain model / database).
  * **Added Properties:**
    * `submittedAt`: `string (ISO Date) | null`
    * `completedAt`: `string (ISO Date) | null`
  * **Example Response:**
    ```json
    {
      "taskId": 1,
      "name": "Design system setup",
      "description": "Initialize Tailwind configuration",
      "startDate": "2026-11-01T00:00:00.000Z",
      "endDate": "2026-11-15T00:00:00.000Z",
      "startedAt": "2026-11-02T10:00:00.000Z",
      "submittedAt": "2026-11-10T14:30:00.000Z",
      "completedAt": "2026-11-11T09:15:00.000Z",
      "status": "COMPLETED",
      "assignedTo": { "userId": 42 },
      "createdAt": "2026-11-01T00:00:00.000Z",
      "updatedAt": "2026-11-11T09:15:00.000Z"
    }
    ```

### 4. Status Codes & Error Handling
* **Authentication Guards (`AuthGuard`, `AdminGuard`):**
  * Unauthenticated requests now return **`401 Unauthorized`** (previously returned `403 Forbidden` or caused server errors on missing sessions).
  * Authenticated users with insufficient privileges (e.g. non-admin attempting admin routes) now explicitly return **`403 Forbidden`**.
* **Task State Transitions:**
  * Illegal task status transitions (e.g. attempting to start a task not in `PENDING`, submitting a task not in `IN_PROGRESS`, or re-completing an already completed task) now return **`409 Conflict`** with transition details (previously returned `400 Bad Request`).
* **Comment Access Control:**
  * Users can edit or delete only their own comments (`403 Forbidden` if attempting to edit or delete someone else's comment).
  * Admins can delete any comment, but edit only their own comments.
  * Comments are validated against the `:taskId` path parameter (`404 Not Found` if a comment does not belong to the specified task).

---

## Phase 2: Security, Auth Hardening, Config & Infrastructure

### 1. New Endpoints & Documentation
* **`GET /docs` (Swagger / OpenAPI UI)**
  * Interactive API documentation generated from DTOs and decorators.
  * Cookie authentication registered (`session` cookie apiKey).
* **`GET /health` (Terminus Health Check)**
  * Returns system status and database ping check.
  * Response format:
    ```json
    {
      "status": "ok",
      "info": {
        "database": { "status": "up" }
      },
      "error": {},
      "details": {
        "database": { "status": "up" }
      }
    }
    ```

### 2. Authentication & Signin Updates
* **`POST /auth/signin`**
  * **Timing-Equalized Uniform 401:** Returns `401 Unauthorized` with message `"Invalid credentials"` regardless of whether the email was not found or the password was incorrect. Scrypt hashing runs with identical cost parameters against a dummy hash for missing users to prevent user enumeration via timing attacks.
  * **Rate Limiting:** Guarded with strict rate limiting (5 attempts per minute per IP) returning `429 Too Many Requests` when exceeded.

### 3. Invitation & Signup Lifecycle
* **`POST /users/invite`**
  * Admins can optionally specify a target `role` (`EMPLOYEE` or `ADMIN`, defaulting to `EMPLOYEE`).
* **`POST /auth/signup?token=:token`**
  * **Expired Token Status:** Returns **`410 Gone`** with message `"Invitation token has expired"` when attempting to register with an expired token (previously returned `404 Not Found`).
  * **Single-Transaction Guarantee:** Token validation, consumption (deletion), and user record creation occur within a single database transaction.
  * **Invited Role Inheritance:** The user account is assigned the role specified on the invite record.

### 4. Session & Cookie Security
* **`POST /auth/signout`**
  * Destroys session cookie (`request.session = null`).
* **Session Cookie Hardening:**
  * Configured with `httpOnly: true`, `sameSite: 'lax'`, `secure: true` (in production), and `trust proxy` enabled on Express adapter.
  * Cookies store only `userId`. Real-time DB hydration on every request validates account state; demoted or soft-deleted users lose authorization immediately with `401 Unauthorized`.

### 5. Admin Self-Protection
* **`DELETE /users/:userId`**
  * Returns **`400 Bad Request`** if an administrator attempts to delete their own account (`"Administrators cannot delete their own account"`).
  * Returns **`400 Bad Request`** if attempting to delete the last remaining administrator in the system (`"Cannot delete the last remaining administrator"`).

### 6. Configuration & Environment Variables
* **`TOKEN_EXPIRATION` Unit Change:**
  * Changed unit from **minutes** to **seconds**.
  * Default value is now `86400` seconds (24 hours), previously `1440` minutes.
  * Used for calculating invitation token expiration: `new Date(Date.now() + expiration * 1000)`.
* **Database & Seed Behavior:**
  * `DatabaseModule` hardcodes `synchronize: false` and relies on TypeORM migrations (`pnpm migration:run`).
  * `ADMIN_EMAIL` and `ADMIN_PASSWORD` are strictly required in production (`NODE_ENV=production`), but optional in development/test environments (skipping seed with a warning if omitted).
