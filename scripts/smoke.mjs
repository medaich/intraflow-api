import http from "http";

const BASE_URL = process.env.API_URL || "http://localhost:3000";
const MAILPIT_URL = process.env.MAILPIT_URL || "http://localhost:8025";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@intraflow.dev";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "AdminPassword123!";

let adminCookies = "";
let createdTeamId = null;
let createdProjectId = null;
let createdTaskId = null;
const testRunId = Date.now();
const inviteTargetEmail = `smoke.invited.${testRunId}@intraflow.dev`;

async function runStep(name, fn) {
  process.stdout.write(`[SMOKE] ${name}... `);
  try {
    const result = await fn();
    console.log("PASS");
    return result;
  } catch (err) {
    console.log("FAIL");
    console.error(`       Error: ${err.message}`);
    process.exit(1);
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (adminCookies) {
    headers["Cookie"] = adminCookies;
  }
  if (options.body && typeof options.body === "object") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { status: res.status, headers: res.headers, body };
}

async function main() {
  console.log(`=== Intraflow API Smoke Verification Suite ===`);
  console.log(`Target API:     ${BASE_URL}`);
  console.log(`Target Mailpit: ${MAILPIT_URL}`);

  // Step 1: Healthcheck
  await runStep("1. Healthcheck (/health)", async () => {
    const res = await request("/health");
    if (res.status !== 200 || res.body.status !== "ok") {
      throw new Error(`Expected status 200 with status='ok', got ${res.status}: ${JSON.stringify(res.body)}`);
    }
  });

  // Step 2: Sign in as initial seeded admin
  await runStep("2. Admin Authentication (/auth/signin)", async () => {
    const res = await request("/auth/signin", {
      method: "POST",
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },
    });

    if (res.status !== 201) {
      throw new Error(`Sign in failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }

    const setCookies = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    if (!setCookies.length) {
      throw new Error("No set-cookie header received from /auth/signin");
    }
    adminCookies = setCookies.map((c) => c.split(";")[0]).join("; ");
  });

  // Step 3: Create Team
  await runStep("3. Create Team (/teams)", async () => {
    const res = await request("/teams", {
      method: "POST",
      body: {
        name: `Smoke Team ${testRunId}`,
        description: "Created during smoke verification",
      },
    });

    if (res.status !== 201 || !res.body.teamId) {
      throw new Error(`Create team failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
    createdTeamId = res.body.teamId;
  });

  // Step 4: Create Project
  await runStep("4. Create Project (/projects)", async () => {
    const res = await request("/projects", {
      method: "POST",
      body: {
        name: `Smoke Project ${testRunId}`,
        description: "Project for smoke testing",
        teamId: createdTeamId,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      },
    });

    if (res.status !== 201 || !res.body.projectId) {
      throw new Error(`Create project failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
    createdProjectId = res.body.projectId;
  });

  // Step 5: Create Task in Project
  await runStep("5. Create Task (/projects/:projectId/tasks)", async () => {
    const res = await request(`/projects/${createdProjectId}/tasks`, {
      method: "POST",
      body: {
        name: `Smoke Task ${testRunId}`,
        description: "Task for smoke testing",
        startDate: "2026-06-01T00:00:00.000Z",
        endDate: "2026-06-30T23:59:59.000Z",
        priority: "HIGH",
      },
    });

    if (res.status !== 201 || !res.body.taskId) {
      throw new Error(`Create task failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
    createdTaskId = res.body.taskId;
  });

  // Step 6: Invite User (triggers email dispatch)
  await runStep("6. Invite User (/users/invite)", async () => {
    const res = await request("/users/invite", {
      method: "POST",
      body: {
        email: inviteTargetEmail,
        role: "EMPLOYEE",
        teamId: createdTeamId,
      },
    });

    if (res.status !== 201) {
      throw new Error(`Invite user failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
  });

  // Step 7: Verify Invite Email Delivery in Mailpit
  await runStep("7. Mailpit Delivery Verification (/api/v1/messages)", async () => {
    // Retry polling mailpit for up to 10 seconds
    const maxRetries = 10;
    let found = false;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const mailRes = await fetch(`${MAILPIT_URL}/api/v1/messages`);
        if (mailRes.ok) {
          const data = await mailRes.json();
          const messages = data.messages || [];
          const match = messages.find((m) =>
            m.To && m.To.some((recipient) => recipient.Address.toLowerCase() === inviteTargetEmail.toLowerCase())
          );
          if (match) {
            found = true;
            break;
          }
        }
      } catch {
        // Mailpit may still be processing
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!found) {
      throw new Error(`Invitation email to ${inviteTargetEmail} was not found in Mailpit!`);
    }
  });

  console.log(`\nAll smoke verification steps completed successfully! (ALL PASS)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error during smoke verification:", err);
  process.exit(1);
});
