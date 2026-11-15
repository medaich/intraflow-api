import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

export interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private isMemoryTransport: boolean;
  private readonly from: string;
  private readonly appUrl: string;
  private sentMails: SentMail[] = [];

  constructor(private readonly configService: ConfigService) {
    const transport = this.configService.get<string>("MAIL_TRANSPORT", "memory");
    this.isMemoryTransport = transport === "memory";
    this.from = this.configService.get<string>("MAIL_FROM", "noreply@intraflow.dev");
    this.appUrl = this.configService.get<string>("APP_URL", "http://localhost:3000");

    if (!this.isMemoryTransport) {
      const host = this.configService.getOrThrow<string>("SMTP_HOST");
      const port = Number(this.configService.get<number>("SMTP_PORT", 1025));
      const user = this.configService.get<string>("SMTP_USER");
      const pass = this.configService.get<string>("SMTP_PASS");

      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      });
    }
  }

  async sendMail(mail: SentMail): Promise<void> {
    if (this.isMemoryTransport) {
      this.sentMails.push(mail);
      this.logger.debug(`[MemoryMail] To: ${mail.to} | Subject: ${mail.subject}`);
      return;
    }

    if (!this.transporter) {
      throw new Error("SMTP transporter is not initialized");
    }

    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }

  async sendInvitation(email: string, token: string): Promise<void> {
    const link = `${this.appUrl}/signup?token=${token}`;
    const subject = "You are invited to join Intraflow";
    const text = `You have been invited to Intraflow. Click the link to complete registration: ${link}`;
    const html = `<p>You have been invited to <strong>Intraflow</strong>.</p><p><a href="${link}">Complete Registration</a></p>`;

    await this.sendMail({ to: email, subject, text, html });
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const link = `${this.appUrl}/reset-password?token=${token}`;
    const subject = "Password Reset Request";
    const text = `A password reset was requested for your account. Reset your password here: ${link}`;
    const html = `<p>A password reset was requested for your account.</p><p><a href="${link}">Reset Password</a></p><p>This link expires in 1 hour.</p>`;

    await this.sendMail({ to: email, subject, text, html });
  }

  async sendEmailChangeVerification(newEmail: string, token: string): Promise<void> {
    const link = `${this.appUrl}/confirm-email?token=${token}`;
    const subject = "Confirm your new email address";
    const text = `Please confirm your new email address for Intraflow: ${link}`;
    const html = `<p>Please confirm your new email address for <strong>Intraflow</strong>:</p><p><a href="${link}">Confirm Email Address</a></p>`;

    await this.sendMail({ to: newEmail, subject, text, html });
  }

  async sendEmailChangeNotice(oldEmail: string): Promise<void> {
    const subject = "Your Intraflow account email has been changed";
    const text = `Your Intraflow account email address has been successfully updated. If you did not make this change, please contact an administrator immediately.`;
    const html = `<p>Your <strong>Intraflow</strong> account email address has been successfully updated.</p><p>If you did not make this change, contact an administrator immediately.</p>`;

    await this.sendMail({ to: oldEmail, subject, text, html });
  }

  async sendTaskAssigned(
    to: string,
    assigneeName: string,
    taskName: string,
    projectName?: string,
  ): Promise<void> {
    const safeAssignee = escapeHtml(assigneeName);
    const safeTask = escapeHtml(taskName);
    const safeProject = projectName ? escapeHtml(projectName) : "Standalone Tasks";

    const subject = `Task Assigned: ${taskName}`;
    const text = `Hello ${assigneeName},\n\nYou have been assigned to task "${taskName}" in project "${safeProject}".`;
    const html = `<p>Hello ${safeAssignee},</p><p>You have been assigned to task <strong>${safeTask}</strong> in project <em>${safeProject}</em>.</p>`;

    await this.sendMail({ to, subject, text, html });
  }

  getSentMails(): SentMail[] {
    return this.sentMails;
  }

  getLastMail(): SentMail | undefined {
    return this.sentMails[this.sentMails.length - 1];
  }

  clearMails(): void {
    this.sentMails = [];
  }
}
