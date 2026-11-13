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
