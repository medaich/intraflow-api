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

---

## Phase 3: Teams, Projects, Task Dependencies & Central Authorization

### 1. Teams Endpoints & Membership Management
* **`POST /teams`**
  * **Access:** Admin only (`403 Forbidden` for non-admins).
  * **Payload:** `{ "name": string, "description"?: string }`
  * **Status:** `201 Created` returning `TeamResponseDto`. Enforces unique team name across all records (`409 Conflict`). Reusing the name of a soft-deleted team is explicitly rejected with `409 Conflict` (`Team with name '...' already exists`) to preserve historical audit trails and prevent identity confusion.
* **`GET /teams`**
  * **Access:** Admin only (`403 Forbidden` for non-admins).
  * **Response:** Array of `TeamResponseDto` (each including `membersCount`).
* **`GET /teams/my-team`**
  * **Access:** Authenticated user with team membership (`404 Not Found` if user is not in a team).
  * **Response:** `TeamResponseDto` including populated `members` list (`userId`, `name`, `role`, `teamRole`, `joinedAt`).
* **`GET /teams/:teamId`**
  * **Access:** Admin or member of the specified team (`404 Not Found` for non-members, `404 Not Found` if team does not exist).
* **`PATCH /teams/:teamId`**
  * **Access:** Admin or MODERATOR of the specified team (`403 Forbidden` for regular members, `404 Not Found` for outsiders).
  * **Payload:** `{ "name"?: string, "description"?: string }`
  * **Status:** `200 OK`. Name uniqueness across active and soft-deleted teams is enforced (`409 Conflict`).
* **`DELETE /teams/:teamId`**
  * **Access:** Admin only (`403 Forbidden` for non-admins).
  * **Status:** `204 No Content`. Soft-deletes team. Blocked with **`409 Conflict`** if the team still has active members or projects. Deleting an empty team soft-deletes the team record.
* **`POST /teams/:teamId/members`**
  * **Access:** Admin or MODERATOR of the specified team (`403 Forbidden` if Moderator attempts to add a MODERATOR; `404 Not Found` for outsiders).
  * **Payload:** `{ "userId": number, "role"?: "MEMBER" | "MODERATOR" }` (defaults to `MEMBER`).
  * **Status:** `201 Created`. Enforces single-team membership: returns **`409 Conflict`** if the user is already a member of any team.
* **`PATCH /teams/:teamId/members/:userId`**
  * **Access:** Admin only (`403 Forbidden` for moderators, `404 Not Found` for outsiders).
  * **Payload:** `{ "role": "MEMBER" | "MODERATOR" }`
  * **Status:** `200 OK`. Promotes or demotes member.
* **`DELETE /teams/:teamId/members/:userId`**
  * **Access:** Admin or MODERATOR of the specified team. A Moderator cannot remove another Moderator or themselves (`403 Forbidden`; `404 Not Found` for outsiders).
  * **Status:** `204 No Content`. Removes membership. In the same transaction: unassigns all open tasks assigned to this user in projects belonging to this team, appending a system comment:
    `[System] User was removed from team. Task reset to UNASSIGNED.`

### 2. Projects Endpoints & Progress Tracking
* **`POST /projects`**
  * **Access:** Admin only (`403 Forbidden` for non-admins).
  * **Payload:** `{ "name": string, "description"?: string, "startDate": string, "endDate": string, "teamId"?: number }`
  * **Status:** `201 Created` returning `ProjectResponseDto`. Returns `400 Bad Request` if `endDate` precedes `startDate`.
* **`GET /projects`**
  * **Access:** Admin (sees all projects) or Employees (sees projects assigned to their team). Non-admin without a team sees an empty array `[]`.
  * **Response:** Plain array of `ProjectResponseDto`. Task progress (`total`, `completed`, `percent`) is computed using a single SQL aggregate query across all projects, preventing N+1 queries.
* **`GET /projects/:projectId`**
  * **Access:** Admin or member of the project's assigned team (`404 Not Found` for outsiders or nonexistent projects).
  * **Response:** `ProjectResponseDto` with computed progress fields:
    * `progress`: `{ "completed": number, "total": number, "percent": number }`
    * `isOverdue`: boolean (`true` if `endDate` is past and status is `ACTIVE`).
* **`PATCH /projects/:projectId`**
  * **Access:** Admin or MODERATOR of the project's assigned team (`403 Forbidden` for regular members, `404 Not Found` for outsiders). Rejects mutations on `ARCHIVED` projects with **`409 Conflict`**.
  * **Payload:** `{ "name"?: string, "description"?: string, "status"?: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED", "startDate"?: string, "endDate"?: string }`
* **`PUT /projects/:projectId/team`**
  * **Access:** Admin only (`403 Forbidden` for non-admins).
  * **Payload:** `{ "teamId": number | null }`
  * **Behavior:** Reassigns or removes project's assigned team. If any assigned task has an assignee who is not a member of the new team, returns **`409 Conflict`** (`Cannot reassign project to another team while tasks are assigned to members of the current team`).
* **`DELETE /projects/:projectId`**
  * **Access:** Admin only. Soft-deletes project (`204 No Content`). Blocked with **`409 Conflict`** if the project still contains associated tasks.
* **`POST /projects/:projectId/tasks`**
  * **Access:** Admin or MODERATOR of the project's assigned team (`403 Forbidden` for members, `404 Not Found` for outsiders). Rejects creation in `ARCHIVED` projects with **`409 Conflict`**.
  * **Payload:** `{ "name": string, "description": string, "startDate": string, "endDate": string }`
  * **Status:** `201 Created` with `projectId` bound.
* **`GET /projects/:projectId/tasks`**
  * **Access:** Admin or member of the project's assigned team (`404 Not Found` for outsiders). Lists all tasks under the project.

### 3. Task Dependencies & DAG Enforcement
* **`PUT /tasks/:taskId/dependencies`**
  * **Access:** Admin or MODERATOR of the task's project team (`403 Forbidden` for members, `404 Not Found` for outsiders). Rejects updates on `ARCHIVED` projects with **`409 Conflict`**.
  * **Payload:** `{ "dependsOn": number[] }`
  * **Status Codes & Validation Rules:**
    * **Cycle detection:** Direct or transitive cycles (e.g. A -> B -> C -> A) are detected using DFS cycle analysis, rejecting with **`409 Conflict`** (`"Circular dependency detected: A -> B -> C -> A"`).
    * **Self-dependency:** A task cannot depend on itself, rejecting with **`400 Bad Request`** (`"A task cannot depend on itself"`).
    * **Cross-project mismatch:** All dependency tasks must belong to the exact same project as `:taskId`, rejecting with **`400 Bad Request`** (`"All dependency tasks must belong to the same project"`).
    * **Nonexistent / deleted dependencies:** Referenced task IDs that do not exist or are deleted reject with **`404 Not Found`** (`"One or more dependency tasks do not exist"`).
* **Task Assignment Scope & Status Codes:**
  * **Assignee Team Membership:** When assigning a task (`POST /tasks/:taskId/assign`), the assignee must belong to the task's project team. Attempting to assign a user outside the project's team returns **`400 Bad Request`** (`"Assignee must be a member of the project team"`), enforced uniformly for both Admins and Moderators.
* **Standalone Task Visibility:**
  * Tasks not assigned to any project (`projectId: null`) are visible to Admins and the specific user they are assigned to. For other moderators or members, standalone tasks return **`404 Not Found`** to protect unshared tasks.
* **Task Start Pre-condition (`POST /tasks/:taskId/start` & `POST /tasks/my-tasks/:taskId/start`):**
  * **Blocked Check:** If any dependency task in `dependsOn` is not in `COMPLETED` status, returns **`409 Conflict`** (`"Cannot start task because 1 or more dependencies are not completed"`, with `blockingTaskIds` list).
  * **Drift Rule:** If a dependency task transitions out of `COMPLETED` after a dependent task has already started (`IN_PROGRESS`), the started task is left untouched.

### 4. Non-Spoofable System Comments & `isSystem` Boolean
* **Comment Model & Response DTO:**
  * Added `isSystem: boolean` to the database schema (`comment.is_system`, tinyint default 0) and exposed in `CommentResponseDto`.
  * Normal user comments posted via `POST /tasks/:taskId/comments` are guaranteed to have `isSystem: false` and `user: { userId, name }`. Any user attempt to spoof system comments by typing `"[System] ..."` receives `isSystem: false` with their user identity attached.
  * System-generated comments (e.g. roster removal, user deactivation, project team reassignments) set `isSystem: true` and `user: null` in the database.
  * *Historical note:* Prior to this change, system comments had no dedicated column and were distinguished only by a nullable author (`user: null`) and the string content prefix `[System]`.

### 4. User Invitation & Account Deactivation Updates
* **`POST /users/invite`**
  * Optional `teamId` field added. When present, token stores the target team.
  * Upon signup (`POST /auth/signup?token=...`), the user is automatically added to the specified team with `MEMBER` role within the same signup transaction.
  * If the team was deleted between invite and signup, registration succeeds cleanly without membership.
* **`DELETE /users/:userId` (Account Deactivation):**
  * In a single transaction: soft-deletes user, unassigns all open tasks (`PENDING` or `IN_PROGRESS`) assigned to the user, appends comment `[System] User was deactivated. Task reset to UNASSIGNED.`, and removes team membership. `COMPLETED` tasks remain completed with assignment intact.

### 5. Response Shape & Sanitization
* All new endpoints return class-transformer DTOs decorated with `@Expose()`:
  * `TeamResponseDto`, `TeamMemberResponseDto`
  * `ProjectResponseDto`
  * `TaskResponseDto` (including `projectId`, `dependsOn`, `blockedBy`, `isBlocked`)
* Password hashes are strictly excluded (`select: false` on entity + DTO stripping). Embedded user objects expose only `userId` and `name` (and `role` where relevant).
