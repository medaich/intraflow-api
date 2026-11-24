import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { UsersService } from "../src/users/users.service";
import { TeamsService } from "../src/teams/teams.service";
import { ProjectsService } from "../src/projects/projects.service";
import { TasksService } from "../src/tasks/tasks.service";
import { User, UserRole } from "../src/users/entities/user.entity";
import { TeamMemberRole } from "../src/teams/entities/team-membership.entity";
import { TaskStatus, TaskPriority } from "../src/tasks/entities/task.entity";
import { hashPassword } from "../src/auth/password-hasher";
import { DataSource } from "typeorm";

const DEMO_TASK_NAMES = [
  "Base Architecture Setup",
  "Database Indexing & Performance Tuning",
  "Cache Layer Deployment",
  "Security Policy Review",
  "API Documentation Sync",
  "Webhook Delivery Architecture",
] as const;

const DEMO_RESET_CONFIRMATION = "RESET_INTRAFLOW_DEMO_TASKS";

async function resetDemoTasks(
  dataSource: DataSource,
  projectId: number,
  alphaTeamId: number,
): Promise<void> {
  const projectRows = await dataSource.query(
    "SELECT team_id, status FROM projects WHERE project_id = ? AND name = ? AND deleted_at IS NULL",
    [projectId, "Intraflow NextGen Platform"],
  );

  if (projectRows.length !== 1 || Number(projectRows[0].team_id) !== Number(alphaTeamId)) {
    throw new Error(
      "Demo task reset refused: the target must be the Intraflow NextGen Platform project owned by Alpha Core.",
    );
  }

  if (projectRows[0].status === "ARCHIVED") {
    throw new Error("Demo task reset refused: the Intraflow NextGen Platform project is archived.");
  }

  const namePlaceholders = DEMO_TASK_NAMES.map(() => "?").join(", ");
  const taskRows = await dataSource.query(
    `SELECT task_id FROM tasks WHERE project_id = ? AND name IN (${namePlaceholders})`,
    [projectId, ...DEMO_TASK_NAMES],
  );
  const taskIds = taskRows.map((row: { task_id: number | string }) => Number(row.task_id));

  if (taskIds.length === 0) {
    console.log("No existing demo tasks need to be reset.");
    return;
  }

  const idPlaceholders = taskIds.map(() => "?").join(", ");
  const externalDependents = await dataSource.query(
    `SELECT DISTINCT dependent.task_id
     FROM task_dependencies AS dependency
     INNER JOIN tasks AS dependent ON dependent.task_id = dependency.task_id
     WHERE dependency.depends_on_task_id IN (${idPlaceholders})
       AND dependent.task_id NOT IN (${idPlaceholders})`,
    [...taskIds, ...taskIds],
  );

  if (externalDependents.length > 0) {
    throw new Error(
      "Demo task reset refused: tasks outside the demo set depend on a demo task.",
    );
  }

  const attachments = await dataSource.query(
    `SELECT attachment_id FROM attachments WHERE task_id IN (${idPlaceholders}) LIMIT 1`,
    taskIds,
  );

  if (attachments.length > 0) {
    throw new Error(
      "Demo task reset refused: remove file attachments from the demo tasks before resetting them.",
    );
  }

  await dataSource.transaction(async (manager) => {
    for (const taskId of taskIds) {
      await manager.query(
        "DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?",
        [taskId, taskId],
      );
    }
    await manager.query(
      `DELETE FROM tasks WHERE task_id IN (${idPlaceholders})`,
      taskIds,
    );
  });

  console.log(`Removed ${taskIds.length} matching demo task record(s) and their task history.`);
}

async function seedDemo() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed demo data in production environment (NODE_ENV=production).");
    process.exit(1);
  }

  const resetDemoTasksRequested = process.argv.includes("--reset-demo-tasks");
  if (
    resetDemoTasksRequested &&
    process.env.DEMO_SEED_RESET_CONFIRMATION !== DEMO_RESET_CONFIRMATION
  ) {
    throw new Error(
      `Demo task reset requires DEMO_SEED_RESET_CONFIRMATION=${DEMO_RESET_CONFIRMATION}.`,
    );
  }

  console.log(
    resetDemoTasksRequested
      ? "Starting demo seed with an explicit reset of the six demo tasks..."
      : "Starting repeatable demo seed; existing task records will be preserved...",
  );
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const dataSource = app.get(DataSource);
  const usersService = app.get(UsersService);
  const teamsService = app.get(TeamsService);
  const projectsService = app.get(ProjectsService);
  const tasksService = app.get(TasksService);

  const userRepo = dataSource.getRepository(User);

  // 1. Ensure Admin exists
  let admin = await usersService.findByEmailWithPassword("admin@intraflow.dev");
  if (!admin) {
    const adminPasswordHash = await hashPassword("AdminPassword123!");
    admin = await userRepo.save(
      userRepo.create({
        name: "Super Admin",
        email: "admin@intraflow.dev",
        password: adminPasswordHash,
        role: UserRole.ADMIN,
      }),
    );
  }

  // 2. Helper to find or create demo users
  const demoUsersData = [
    { name: "Alpha Moderator", email: "mod.alpha@intraflow.dev", role: UserRole.EMPLOYEE },
    { name: "Alpha Developer", email: "dev.alpha@intraflow.dev", role: UserRole.EMPLOYEE },
    { name: "Beta Moderator", email: "mod.beta@intraflow.dev", role: UserRole.EMPLOYEE },
    { name: "Beta Developer", email: "dev.beta@intraflow.dev", role: UserRole.EMPLOYEE },
  ];

  const demoUsers: Record<string, User> = {};
  const demoPasswordHash = await hashPassword("DemoPassword123!");

  for (const u of demoUsersData) {
    let existing = await usersService.findByEmailWithPassword(u.email);
    if (!existing) {
      existing = await userRepo.save(
        userRepo.create({
          name: u.name,
          email: u.email,
          password: demoPasswordHash,
          role: u.role,
        }),
      );
    }
    demoUsers[u.email] = existing;
  }

  // 3. Teams (2 teams)
  const teamsData = [
    { name: "Alpha Core", description: "Core product development & backend team" },
    { name: "Beta Platform", description: "Cloud infrastructure and platform reliability team" },
  ];

  const teams: Record<string, any> = {};
  for (const td of teamsData) {
    const existing = await dataSource.query("SELECT * FROM teams WHERE name = ? AND deleted_at IS NULL", [td.name]);
    if (existing.length > 0) {
      teams[td.name] = existing[0];
    } else {
      const created = await teamsService.create({ name: td.name, description: td.description });
      teams[td.name] = created;
    }
  }

  // 4. Team Memberships
  // Team Alpha: mod.alpha (MODERATOR), dev.alpha (MEMBER)
  const alphaTeamId = teams["Alpha Core"].teamId ?? teams["Alpha Core"].team_id;
  try {
    await teamsService.addMember(admin, alphaTeamId, {
      userId: demoUsers["mod.alpha@intraflow.dev"].userId,
      role: TeamMemberRole.MODERATOR,
    });
  } catch {
    // Already member
  }
  try {
    await teamsService.addMember(admin, alphaTeamId, {
      userId: demoUsers["dev.alpha@intraflow.dev"].userId,
      role: TeamMemberRole.MEMBER,
    });
  } catch {
    // Already member
  }

  // Team Beta: mod.beta (MODERATOR), dev.beta (MEMBER)
  const betaTeamId = teams["Beta Platform"].teamId ?? teams["Beta Platform"].team_id;
  try {
    await teamsService.addMember(admin, betaTeamId, {
      userId: demoUsers["mod.beta@intraflow.dev"].userId,
      role: TeamMemberRole.MODERATOR,
    });
  } catch {
    // Already member
  }
  try {
    await teamsService.addMember(admin, betaTeamId, {
      userId: demoUsers["dev.beta@intraflow.dev"].userId,
      role: TeamMemberRole.MEMBER,
    });
  } catch {
    // Already member
  }

  // 5. Projects
  let alphaProject: any;
  const existingProjects = await dataSource.query(
    "SELECT * FROM projects WHERE name = ? AND deleted_at IS NULL",
    ["Intraflow NextGen Platform"],
  );
  if (existingProjects.length > 0) {
    alphaProject = existingProjects[0];
  } else {
    alphaProject = await projectsService.create(
      {
        name: "Intraflow NextGen Platform",
        description: "Enterprise project management overhaul",
        teamId: alphaTeamId,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      },
      admin,
    );
  }
  const projectId = alphaProject.projectId ?? alphaProject.project_id;

  if (Number(alphaProject.teamId ?? alphaProject.team_id) !== Number(alphaTeamId)) {
    throw new Error(
      "Demo seed refused: Intraflow NextGen Platform must belong to the Alpha Core team.",
    );
  }

  if (resetDemoTasksRequested) {
    await resetDemoTasks(dataSource, projectId, alphaTeamId);
  }

  // 6. Tasks in every status + dependencies + reject flow
  // Reload users with their membership relation loaded so policy checks succeed
  const devAlpha = (await userRepo.findOne({
    where: { userId: demoUsers["dev.alpha@intraflow.dev"].userId },
    relations: ["membership"],
  }))!;
  const modAlpha = (await userRepo.findOne({
    where: { userId: demoUsers["mod.alpha@intraflow.dev"].userId },
    relations: ["membership"],
  }))!;

  // Helper to find task by name in project
  async function findTask(name: string) {
    const rows = await dataSource.query(
      "SELECT * FROM tasks WHERE project_id = ? AND name = ? AND deleted_at IS NULL",
      [projectId, name],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Task 1: COMPLETED
  let task1 = await findTask("Base Architecture Setup");
  if (!task1) {
    const t = await tasksService.createInProject(
      projectId,
      {
        name: "Base Architecture Setup",
        description: "Initial database schemas, nest scaffolding and docker compose",
        priority: TaskPriority.HIGH,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-06-30"),
      },
      admin,
    );
    await tasksService.assign(t.taskId, devAlpha.userId, admin);
    await tasksService.start(t.taskId, devAlpha.userId);
    await tasksService.submit(t.taskId, devAlpha.userId);
    await tasksService.validate(t.taskId, admin);
    task1 = await findTask("Base Architecture Setup");
  }

  // Task 2: IN_PROGRESS (depends on Task 1)
  let task2 = await findTask("Database Indexing & Performance Tuning");
  if (!task2) {
    const t = await tasksService.createInProject(
      projectId,
      {
        name: "Database Indexing & Performance Tuning",
        description: "Add comprehensive compound indexes for high query throughput",
        priority: TaskPriority.MEDIUM,
        startDate: new Date("2026-02-01"),
        endDate: new Date("2026-08-31"),
      },
      admin,
    );
    const task1Id = task1.taskId ?? task1.task_id;
    await tasksService.setDependencies(t.taskId, { dependsOn: [task1Id] }, admin);
    await tasksService.assign(t.taskId, devAlpha.userId, admin);
    await tasksService.start(t.taskId, devAlpha.userId);
    await tasksService.comment(
      t.taskId,
      devAlpha.userId,
      "Performance metrics show a 30% reduction in query latency after indexing.",
      devAlpha,
    );
    task2 = await findTask("Database Indexing & Performance Tuning");
  }

  // Task 3: PENDING with unfulfilled dependency (depends on Task 2, which is still IN_PROGRESS)
  let task3 = await findTask("Cache Layer Deployment");
  if (!task3) {
    const t = await tasksService.createInProject(
      projectId,
      {
        name: "Cache Layer Deployment",
        description: "Deploy Redis cluster for query cache",
        priority: TaskPriority.LOW,
        startDate: new Date("2026-03-01"),
        endDate: new Date("2026-09-30"),
      },
      admin,
    );
    const task2Id = task2.taskId ?? task2.task_id;
    await tasksService.setDependencies(t.taskId, { dependsOn: [task2Id] }, admin);
    await tasksService.assign(t.taskId, devAlpha.userId, admin);
    // Task cannot start because dependency Task 2 is not completed -> status remains PENDING with derived isBlocked=true
  }

  // Task 4: PENDING (assigned, ready to start)
  let task4 = await findTask("Security Policy Review");
  if (!task4) {
    const t = await tasksService.createInProject(
      projectId,
      {
        name: "Security Policy Review",
        description: "Audit role-based authorization matrix for all endpoints",
        priority: TaskPriority.URGENT,
        startDate: new Date("2026-04-01"),
        endDate: new Date("2026-10-31"),
      },
      admin,
    );
    await tasksService.assign(t.taskId, devAlpha.userId, admin);
  }

  // Task 5: IN_REVIEW
  let task5 = await findTask("API Documentation Sync");
  if (!task5) {
    const t = await tasksService.createInProject(
      projectId,
      {
        name: "API Documentation Sync",
        description: "Update swagger definitions and export openapi specs",
        priority: TaskPriority.MEDIUM,
        startDate: new Date("2026-05-01"),
        endDate: new Date("2026-11-30"),
      },
      admin,
    );
    await tasksService.assign(t.taskId, devAlpha.userId, admin);
    await tasksService.start(t.taskId, devAlpha.userId);
    await tasksService.submit(t.taskId, devAlpha.userId);
  }

  // Task 6: REJECTED THEN RESUBMITTED
  let task6 = await findTask("Webhook Delivery Architecture");
  if (!task6) {
    const t = await tasksService.createInProject(
      projectId,
      {
        name: "Webhook Delivery Architecture",
        description: "Implement outbound webhook delivery for system events",
        priority: TaskPriority.HIGH,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-12-31"),
      },
      admin,
    );
    await tasksService.assign(t.taskId, devAlpha.userId, admin);
    await tasksService.start(t.taskId, devAlpha.userId);
    await tasksService.submit(t.taskId, devAlpha.userId);
    // Moderator rejects with feedback
    await tasksService.reject(
      t.taskId,
      { reason: "Please add retry backoff strategy before approval." },
      modAlpha,
    );
    // Developer adds comment addressing feedback and resubmits
    await tasksService.comment(
      t.taskId,
      devAlpha.userId,
      "Implemented exponential backoff retry mechanism. Resubmitting for review.",
      devAlpha,
    );
    await tasksService.submit(t.taskId, devAlpha.userId);
  }

  console.log("Demo data seeded successfully!");
  console.log("Accounts created:");
  console.log("  - admin@intraflow.dev (ADMIN) | AdminPassword123!");
  console.log("  - mod.alpha@intraflow.dev (Alpha Moderator) | DemoPassword123!");
  console.log("  - dev.alpha@intraflow.dev (Alpha Member) | DemoPassword123!");
  console.log("  - mod.beta@intraflow.dev (Beta Moderator) | DemoPassword123!");
  console.log("  - dev.beta@intraflow.dev (Beta Member) | DemoPassword123!");

  await app.close();
  process.exit(0);
}

seedDemo().catch((err) => {
  console.error("Demo seeding failed:", err);
  process.exit(1);
});
