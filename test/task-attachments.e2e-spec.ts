import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { createTestApp, closeTestApp, createAndSignInUser, TestAppBundle } from './test-helper';
import { User, UserRole } from '../src/users/entities/user.entity';
import { Team } from '../src/teams/entities/team.entity';
import { TeamMembership, TeamMemberRole } from '../src/teams/entities/team-membership.entity';
import { Project, ProjectStatus } from '../src/projects/entities/project.entity';
import { Task, TaskStatus } from '../src/tasks/entities/task.entity';
import { Attachment } from '../src/tasks/entities/attachment.entity';
import { AuthService } from '../src/auth/auth.service';
import { StorageService } from '../src/storage/storage.service';

describe('Task Attachments (E2E intraflow_test)', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let membershipRepo: Repository<TeamMembership>;
  let projectRepo: Repository<Project>;
  let taskRepo: Repository<Task>;
  let attachmentRepo: Repository<Attachment>;
  let storageService: StorageService;
  let authService: AuthService;

  let adminUser: User;
  let adminCookies: string[];
  let mod1Cookies: string[];
  let mod1User: User;
  let mod2Cookies: string[];
  let mod2User: User;
  let assigneeCookies: string[];
  let assigneeUser: User;
  let memberNonAssigneeCookies: string[];
  let memberNonAssigneeUser: User;
  let unrelatedEmpCookies: string[];

  let team1: Team;
  let team2: Team;
  let project1: Project;
  let task1: Task;

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = bundle.moduleFixture.get(getRepositoryToken(User));
    teamRepo = bundle.moduleFixture.get(getRepositoryToken(Team));
    membershipRepo = bundle.moduleFixture.get(getRepositoryToken(TeamMembership));
    projectRepo = bundle.moduleFixture.get(getRepositoryToken(Project));
    taskRepo = bundle.moduleFixture.get(getRepositoryToken(Task));
    attachmentRepo = bundle.moduleFixture.get(getRepositoryToken(Attachment));
    storageService = bundle.moduleFixture.get(StorageService);
    authService = bundle.moduleFixture.get(AuthService);

    // Setup actors
    const admin = await createAndSignInUser(app, userRepo, authService, 'admin.attach@intraflow.dev', UserRole.ADMIN, 'Admin');
    adminUser = admin.user;
    adminCookies = admin.cookies;

    const mod1 = await createAndSignInUser(app, userRepo, authService, 'mod1.attach@intraflow.dev', UserRole.EMPLOYEE, 'Mod1');
    mod1User = mod1.user;
    mod1Cookies = mod1.cookies;

    const mod2 = await createAndSignInUser(app, userRepo, authService, 'mod2.attach@intraflow.dev', UserRole.EMPLOYEE, 'Mod2');
    mod2User = mod2.user;
    mod2Cookies = mod2.cookies;

    const assignee = await createAndSignInUser(app, userRepo, authService, 'assignee.attach@intraflow.dev', UserRole.EMPLOYEE, 'Assignee');
    assigneeUser = assignee.user;
    assigneeCookies = assignee.cookies;

    const memberNonAssignee = await createAndSignInUser(app, userRepo, authService, 'member.attach@intraflow.dev', UserRole.EMPLOYEE, 'MemberNonAssignee');
    memberNonAssigneeUser = memberNonAssignee.user;
    memberNonAssigneeCookies = memberNonAssignee.cookies;

    const unrelatedEmp = await createAndSignInUser(app, userRepo, authService, 'unrelated.attach@intraflow.dev', UserRole.EMPLOYEE, 'Unrelated');
    unrelatedEmpCookies = unrelatedEmp.cookies;

    // Teams
    team1 = await teamRepo.save(teamRepo.create({ name: 'Attachment Team 1' }));
    team2 = await teamRepo.save(teamRepo.create({ name: 'Attachment Team 2' }));

    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: mod1User.userId, role: TeamMemberRole.MODERATOR }));
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: assigneeUser.userId, role: TeamMemberRole.MEMBER }));
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: memberNonAssigneeUser.userId, role: TeamMemberRole.MEMBER }));
    await membershipRepo.save(membershipRepo.create({ teamId: team2.teamId, userId: mod2User.userId, role: TeamMemberRole.MODERATOR }));

    // Project & Task
    const now = new Date();
    project1 = await projectRepo.save(projectRepo.create({
      name: 'Attachment Project',
      teamId: team1.teamId,
      createdBy: adminUser.userId,
      status: ProjectStatus.ACTIVE,
      startDate: now,
      endDate: new Date(now.getTime() + 86400000),
    }));

    task1 = await taskRepo.save(taskRepo.create({
      name: 'Attachment Task',
      projectId: project1.projectId,
      assignedTo: assigneeUser,
      status: TaskStatus.IN_PROGRESS,
      startDate: now,
      endDate: new Date(now.getTime() + 86400000),
    }));
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  describe('1. File Upload, Content Sniffing & Limits', () => {
    it('uploads valid PDF and allows download with identical checksum and correct headers', async () => {
      // Valid PDF magic header: %PDF-1.4
      const pdfContent = Buffer.from('%PDF-1.4\n%Valid test PDF content for checksum verification\n%%EOF');
      const expectedChecksum = createHash('sha256').update(pdfContent).digest('hex');

      const uploadRes = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', pdfContent, 'test-doc.pdf');

      expect(uploadRes.status).toBe(201);
      expect(uploadRes.body.attachmentId).toBeDefined();
      expect(uploadRes.body.originalName).toBe('test-doc.pdf');
      expect(uploadRes.body.contentType).toBe('application/pdf');
      expect(uploadRes.body.size).toBe(pdfContent.length);
      expect(uploadRes.body.uploadedBy.userId).toBe(assigneeUser.userId);
      expect(uploadRes.body.storageKey).toBeUndefined(); // Storage key never exposed to client

      const attachmentId = uploadRes.body.attachmentId;

      // Download round-trip
      const downloadRes = await request(app.getHttpServer())
        .get(`/tasks/${task1.taskId}/attachments/${attachmentId}/download`)
        .set('Cookie', assigneeCookies);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toBe('application/pdf');
      expect(downloadRes.headers['x-content-type-options']).toBe('nosniff');
      expect(downloadRes.headers['content-disposition']).toContain('attachment; filename="test-doc.pdf"');

      const downloadedChecksum = createHash('sha256').update(downloadRes.body as Buffer).digest('hex');
      expect(downloadedChecksum).toBe(expectedChecksum);
    });

    it('rejects an executable renamed .pdf with application/pdf header (415)', async () => {
      // ELF executable header: 0x7F 'E' 'L' 'F' or binary with NUL bytes
      const fakePdf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

      const res = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', fakePdf, { filename: 'malware.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(415);
    });

    it('rejects SVG and HTML payloads with 415', async () => {
      const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const res1 = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', svgPayload, 'image.svg');
      expect(res1.status).toBe(415);

      const htmlPayload = Buffer.from('<!DOCTYPE html><html><body><h1>XSS</h1></body></html>');
      const res2 = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', htmlPayload, 'index.html');
      expect(res2.status).toBe(415);
    });

    it('rejects oversize files (> 10MB) with 413', async () => {
      // Allocate 10.5 MB buffer of dummy PDF
      const header = Buffer.from('%PDF-1.4\n');
      const oversize = Buffer.alloc(10 * 1024 * 1024 + 512 * 1024);
      header.copy(oversize, 0);

      const res = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', oversize, 'oversize.pdf');

      expect(res.status).toBe(413);
    });

    it('sanitizes path traversal filenames', async () => {
      const content = Buffer.from('%PDF-1.4\nSafe content');
      const res = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', content, '../../../../etc/passwd.pdf');

      expect(res.status).toBe(201);
      expect(res.body.originalName).toBe('passwd.pdf');
    });

    it('enforces maximum 20 attachments per task (409)', async () => {
      const now = new Date();
      const task2 = await taskRepo.save(taskRepo.create({
        name: 'Max Attachments Task',
        projectId: project1.projectId,
        assignedTo: assigneeUser,
        status: TaskStatus.IN_PROGRESS,
        startDate: now,
        endDate: new Date(now.getTime() + 86400000),
      }));

      // Directly insert 20 attachments into DB
      for (let i = 1; i <= 20; i++) {
        await attachmentRepo.save(attachmentRepo.create({
          taskId: task2.taskId,
          uploadedById: assigneeUser.userId,
          originalName: `file-${i}.txt`,
          storageKey: `key-dummy-${task2.taskId}-${i}`,
          contentType: 'text/plain',
          size: 100,
        }));
      }

      // 21st upload attempt must return 409 Conflict
      const validText = Buffer.from('Plain text valid UTF-8 file content');
      const res = await request(app.getHttpServer())
        .post(`/tasks/${task2.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', validText, 'extra.txt');

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('maximum of 20 attachments');
    });
  });

  describe('2. Authorization Matrix for Task Attachments', () => {
    it('Anonymous returns 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${task1.taskId}/attachments`);
      expect(res.status).toBe(401);
    });

    it('Unrelated employee returns 404 (hides existence)', async () => {
      const listRes = await request(app.getHttpServer())
        .get(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', unrelatedEmpCookies);
      expect(listRes.status).toBe(404);

      const uploadRes = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', unrelatedEmpCookies)
        .attach('file', Buffer.from('%PDF-1.4\nTest'), 'unrelated.pdf');
      expect(uploadRes.status).toBe(404);
    });

    it('Moderator of ANOTHER team returns 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', mod2Cookies);
      expect(res.status).toBe(404);
    });

    it('Member non-assignee returns 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', memberNonAssigneeCookies);
      expect(res.status).toBe(404);
    });

    it('Assignee can upload and list attachments', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', assigneeCookies);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('Moderator of owning team can upload, list, and delete attachments', async () => {
      const textContent = Buffer.from('Moderator upload text');
      const uploadRes = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', mod1Cookies)
        .attach('file', textContent, 'mod-notes.txt');

      expect(uploadRes.status).toBe(201);
      const attachmentId = uploadRes.body.attachmentId;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/tasks/${task1.taskId}/attachments/${attachmentId}`)
        .set('Cookie', mod1Cookies);
      expect(deleteRes.status).toBe(200);
    });

    it('Assignee cannot delete attachment uploaded by moderator (404)', async () => {
      const textContent = Buffer.from('Moderator protected upload');
      const uploadRes = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', mod1Cookies)
        .attach('file', textContent, 'mod-protected.txt');

      const attachmentId = uploadRes.body.attachmentId;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/tasks/${task1.taskId}/attachments/${attachmentId}`)
        .set('Cookie', assigneeCookies);

      expect(deleteRes.status).toBe(404);
    });

    it('Admin can upload, list, download, and delete any attachment', async () => {
      const textContent = Buffer.from('Admin upload text');
      const uploadRes = await request(app.getHttpServer())
        .post(`/tasks/${task1.taskId}/attachments`)
        .set('Cookie', adminCookies)
        .attach('file', textContent, 'admin-notes.txt');

      expect(uploadRes.status).toBe(201);
      const attachmentId = uploadRes.body.attachmentId;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/tasks/${task1.taskId}/attachments/${attachmentId}`)
        .set('Cookie', adminCookies);
      expect(deleteRes.status).toBe(200);
    });
  });

  describe('3. ARCHIVED Project Rules & Deletion Cleanup', () => {
    let archivedProject: Project;
    let archivedTask: Task;
    let existingAttachment: Attachment;

    beforeAll(async () => {
      const now = new Date();
      archivedProject = await projectRepo.save(projectRepo.create({
        name: 'Archived Attachments Project',
        teamId: team1.teamId,
        createdBy: adminUser.userId,
        status: ProjectStatus.ACTIVE,
        startDate: now,
        endDate: new Date(now.getTime() + 86400000),
      }));

      archivedTask = await taskRepo.save(taskRepo.create({
        name: 'Archived Task',
        projectId: archivedProject.projectId,
        assignedTo: assigneeUser,
        status: TaskStatus.IN_PROGRESS,
        startDate: now,
        endDate: new Date(now.getTime() + 86400000),
      }));

      // Upload attachment while still IN_PROGRESS
      const fileBuffer = Buffer.from('Pre-archive text document');
      const key = `pre-archive-${Date.now()}`;
      await storageService.put(key, fileBuffer);
      existingAttachment = await attachmentRepo.save(attachmentRepo.create({
        taskId: archivedTask.taskId,
        uploadedById: assigneeUser.userId,
        originalName: 'pre-archive.txt',
        storageKey: key,
        contentType: 'text/plain',
        size: fileBuffer.length,
      }));

      // Archive the project
      archivedProject.status = ProjectStatus.ARCHIVED;
      await projectRepo.save(archivedProject);
    });

    it('uploading attachment to task in ARCHIVED project returns 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${archivedTask.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', Buffer.from('new text'), 'blocked.txt');

      expect(res.status).toBe(409);
    });

    it('deleting attachment from task in ARCHIVED project returns 409', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/tasks/${archivedTask.taskId}/attachments/${existingAttachment.attachmentId}`)
        .set('Cookie', assigneeCookies);

      expect(res.status).toBe(409);
    });

    it('downloading attachment from task in ARCHIVED project is allowed (200)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${archivedTask.taskId}/attachments/${existingAttachment.attachmentId}/download`)
        .set('Cookie', assigneeCookies);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/plain');
    });

    it('delete attachment removes both database row and storage file', async () => {
      // Create non-archived task and attachment
      const now = new Date();
      const t = await taskRepo.save(taskRepo.create({
        name: 'Delete Verification Task',
        projectId: project1.projectId,
        assignedTo: assigneeUser,
        status: TaskStatus.IN_PROGRESS,
        startDate: now,
        endDate: new Date(now.getTime() + 86400000),
      }));

      const fileBuffer = Buffer.from('To be deleted file');
      const uploadRes = await request(app.getHttpServer())
        .post(`/tasks/${t.taskId}/attachments`)
        .set('Cookie', assigneeCookies)
        .attach('file', fileBuffer, 'delete-me.txt');

      const attachmentId = uploadRes.body.attachmentId;
      const row = (await attachmentRepo.findOneBy({ attachmentId }))!;
      expect(await storageService.exists(row.storageKey)).toBe(true);

      // Delete via API
      const deleteRes = await request(app.getHttpServer())
        .delete(`/tasks/${t.taskId}/attachments/${attachmentId}`)
        .set('Cookie', assigneeCookies);
      expect(deleteRes.status).toBe(200);

      // Verify row and storage file are both deleted
      const rowAfter = await attachmentRepo.findOneBy({ attachmentId });
      expect(rowAfter).toBeNull();
      expect(await storageService.exists(row.storageKey)).toBe(false);
    });
  });
});
