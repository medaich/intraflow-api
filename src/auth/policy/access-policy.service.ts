import { Injectable } from '@nestjs/common';
import { User, UserRole } from '../../users/entities/user.entity';
import { Team } from '../../teams/entities/team.entity';
import { TeamMemberRole } from '../../teams/entities/team-membership.entity';
import { Project } from '../../projects/entities/project.entity';
import { Task } from '../../tasks/entities/task.entity';

@Injectable()
export class AccessPolicyService {
  /**
   * Admin can view all teams.
   * Non-admins can only view the team they belong to.
   */
  canViewTeam(user: User, team: Team): boolean {
    if (user.role === UserRole.ADMIN) {
      return true;
    }
    return user.membership?.teamId === team.teamId;
  }

  /**
   * Admin may manage any roster role (MEMBER and MODERATOR).
   * Moderator of that team only may add/remove MEMBERs.
   * Moderator may NOT change roles, add moderators, or remove moderators -> false.
   * Members / non-members cannot manage roster.
   */
  canManageTeamRoster(user: User, team: Team, targetRole: TeamMemberRole = TeamMemberRole.MEMBER): boolean {
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    const isTeamModerator =
      user.membership?.teamId === team.teamId &&
      user.membership?.role === TeamMemberRole.MODERATOR;

    if (!isTeamModerator) {
      return false;
    }

    // Moderator may only manage MEMBER role, not MODERATOR
    return targetRole === TeamMemberRole.MEMBER;
  }

  /**
   * Admin can view all projects.
   * Non-admins can view projects belonging to their team.
   * Standalone projects (without a team) are invisible to non-admins.
   */
  canViewProject(user: User, project: Project): boolean {
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    if (!project.teamId) {
      return false;
    }

    return user.membership?.teamId === project.teamId;
  }

  /**
   * Admin can manage projects (CRUD, team assignments, general updates).
   * Non-admins cannot manage project entities (except moderator setting COMPLETED status via specific endpoint).
   */
  canManageProject(user: User, project?: Project): boolean {
    if (project && user.role === UserRole.ADMIN) {
      return true;
    }
    return user.role === UserRole.ADMIN;
  }

  /**
   * Admin can manage all tasks.
   * Moderator of the project's team can manage tasks in that project.
   * Project-less tasks remain invisible and unmanageable for non-admins.
   */
  canManageTask(user: User, task: Task): boolean {
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    const taskTeamId = task.project?.teamId ?? null;
    if (!taskTeamId) {
      return false;
    }

    return (
      user.membership?.teamId === taskTeamId &&
      user.membership?.role === TeamMemberRole.MODERATOR
    );
  }

  /**
   * Assignment rule:
   * - Assignee cannot be an Admin (admins are never team members/assignees).
   * - If task has a project with a team:
   *   Assignee must be a member or moderator of THAT team (even if assigned by Admin).
   *   Caller must be Admin or moderator of that team.
   * - If standalone or team-less project:
   *   Only Admin can assign, to any non-admin user.
   */
  canAssignTask(user: User, task: Task, assignee: User): boolean {
    // Admins cannot be assigned tasks
    if (assignee.role === UserRole.ADMIN) {
      return false;
    }

    const taskTeamId = task.project?.teamId ?? null;

    if (taskTeamId) {
      // Must be assigned to someone in that team
      const isAssigneeInTeam = assignee.membership?.teamId === taskTeamId;
      if (!isAssigneeInTeam) {
        return false;
      }

      // Caller must be Admin or Moderator of that team
      return (
        user.role === UserRole.ADMIN ||
        (user.membership?.teamId === taskTeamId &&
          user.membership?.role === TeamMemberRole.MODERATOR)
      );
    }

    // Standalone or team-less project: only Admin can assign
    return user.role === UserRole.ADMIN;
  }

  /**
   * Reviewing / validating / rejecting tasks:
   * - Admin: full access.
   * - Moderator of the project's team: allowed for tasks in their team.
   * - Members: cannot review/validate tasks.
   * - Standalone tasks: admin-only.
   */
  canReviewTask(user: User, task: Task): boolean {
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    const taskTeamId = task.project?.teamId ?? null;
    if (!taskTeamId) {
      return false;
    }

    return (
      user.membership?.teamId === taskTeamId &&
      user.membership?.role === TeamMemberRole.MODERATOR
    );
  }

  /**
   * Comment moderation:
   * - Admin: full access.
   * - Moderator of project's team: can delete any comment on their team's tasks.
   * - Non-moderators / standalone: admin-only.
   */
  canModerateComments(user: User, task: Task): boolean {
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    const taskTeamId = task.project?.teamId ?? null;
    if (!taskTeamId) {
      return false;
    }

    return (
      user.membership?.teamId === taskTeamId &&
      user.membership?.role === TeamMemberRole.MODERATOR
    );
  }

  /**
   * Attachment management (upload, list, download):
   * - Admin: full access.
   * - Moderator of the project team: allowed for project tasks.
   * - Assignee of the task: allowed.
   * - Standalone tasks: Admin and assignee only.
   * - Everyone else -> false.
   */
  canManageAttachments(user: User, task: Task): boolean {
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    if (task.assignedTo && task.assignedTo.userId === user.userId) {
      return true;
    }

    const taskTeamId = task.project?.teamId ?? null;
    if (taskTeamId) {
      return (
        user.membership?.teamId === taskTeamId &&
        user.membership?.role === TeamMemberRole.MODERATOR
      );
    }

    return false;
  }

  /**
   * Attachment deletion:
   * - Uploader: allowed.
   * - Admin: full access.
   * - Moderator of the project team: allowed.
   * - Everyone else -> false.
   */
  canDeleteAttachment(
    user: User,
    attachment: { uploadedById?: number | null },
    task: Task,
  ): boolean {
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    if (attachment.uploadedById && attachment.uploadedById === user.userId) {
      return true;
    }

    const taskTeamId = task.project?.teamId ?? null;
    if (taskTeamId) {
      return (
        user.membership?.teamId === taskTeamId &&
        user.membership?.role === TeamMemberRole.MODERATOR
      );
    }

    return false;
  }
}

