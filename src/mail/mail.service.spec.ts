import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MailService, escapeHtml } from "./mail.service";
import * as nodemailer from "nodemailer";

jest.mock("nodemailer");

describe("MailService", () => {
  describe("escapeHtml", () => {
    it("escapes special HTML characters correctly", () => {
      expect(escapeHtml("")).toBe("");
      expect(escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;",
      );
      expect(escapeHtml('Tom & "Jerry"')).toBe("Tom &amp; &quot;Jerry&quot;");
    });
  });

  describe("Memory Transport Mode", () => {
    let service: MailService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: unknown) => {
                if (key === "MAIL_TRANSPORT") return "memory";
                if (key === "MAIL_FROM") return "noreply@intraflow.dev";
                if (key === "APP_URL") return "http://localhost:3000";
                return defaultValue;
              }),
              getOrThrow: jest.fn(),
            },
          },
        ],
      }).compile();

      service = module.get<MailService>(MailService);
    });

    it("sends and collects invitation emails in memory", async () => {
      await service.sendInvitation("user@intraflow.dev", "invite-token-123");
      expect(service.getSentMails().length).toBe(1);
      const mail = service.getLastMail();
      expect(mail?.to).toBe("user@intraflow.dev");
      expect(mail?.subject).toContain("invited");
      expect(mail?.html).toContain("signup?token=invite-token-123");
    });

    it("sends password reset emails", async () => {
      await service.sendPasswordReset("user@intraflow.dev", "reset-token-456");
      const mail = service.getLastMail();
      expect(mail?.to).toBe("user@intraflow.dev");
      expect(mail?.subject).toBe("Password Reset Request");
      expect(mail?.html).toContain("reset-password?token=reset-token-456");
    });

    it("sends email change verification and change notice", async () => {
      await service.sendEmailChangeVerification("new@intraflow.dev", "verify-token-789");
      expect(service.getLastMail()?.to).toBe("new@intraflow.dev");
      expect(service.getLastMail()?.html).toContain("confirm-email?token=verify-token-789");

      await service.sendEmailChangeNotice("old@intraflow.dev");
      expect(service.getLastMail()?.to).toBe("old@intraflow.dev");
      expect(service.getLastMail()?.subject).toContain("email has been changed");
    });

    it("sends task assigned notifications with HTML escaping", async () => {
      await service.sendTaskAssigned(
        "worker@intraflow.dev",
        "Alice <Dev>",
        "Fix & Test",
        "Project <b>One</b>",
      );
      const mail = service.getLastMail();
      expect(mail?.to).toBe("worker@intraflow.dev");
      expect(mail?.html).toContain("Alice &lt;Dev&gt;");
      expect(mail?.html).toContain("Fix &amp; Test");
      expect(mail?.html).toContain("Project &lt;b&gt;One&lt;/b&gt;");
    });

    it("clears mails correctly", async () => {
      await service.sendPasswordReset("test@intraflow.dev", "tok");
      expect(service.getSentMails().length).toBe(1);
      service.clearMails();
      expect(service.getSentMails().length).toBe(0);
      expect(service.getLastMail()).toBeUndefined();
    });
  });

  describe("SMTP Transport Mode", () => {
    let service: MailService;
    let mockSendMail: jest.Mock;

    beforeEach(async () => {
      mockSendMail = jest.fn().mockResolvedValue({ messageId: "123" });
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        sendMail: mockSendMail,
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: unknown) => {
                if (key === "MAIL_TRANSPORT") return "smtp";
                if (key === "MAIL_FROM") return "noreply@intraflow.dev";
                if (key === "APP_URL") return "http://localhost:3000";
                if (key === "SMTP_PORT") return 1025;
                if (key === "SMTP_USER") return "user";
                if (key === "SMTP_PASS") return "pass";
                return defaultValue;
              }),
              getOrThrow: jest.fn((key: string) => {
                if (key === "SMTP_HOST") return "localhost";
                return "";
              }),
            },
          },
        ],
      }).compile();

      service = module.get<MailService>(MailService);
    });

    it("calls transporter.sendMail in SMTP mode", async () => {
      await service.sendInvitation("recipient@intraflow.dev", "smtp-token");
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "noreply@intraflow.dev",
          to: "recipient@intraflow.dev",
        }),
      );
    });
  });
});
