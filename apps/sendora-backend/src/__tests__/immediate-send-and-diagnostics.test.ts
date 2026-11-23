import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- Mocks -----

const { mockPrisma, mockSendMail, mockClose, mockRedis } = vi.hoisted(() => ({
  mockPrisma: {
    campaignEmail: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    campaignMessage: {
      create: vi.fn().mockResolvedValue({ id: "msg-rec-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      update: vi.fn(),
    },
  },
  mockSendMail: vi.fn(),
  mockClose: vi.fn(),
  mockRedis: {
    on: vi.fn(),
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    status: "ready",
  },
}));

vi.mock("../config/redis.js", () => ({
  Queue: vi.fn(),
  Worker: vi.fn(),
  createRedisClient: vi.fn(() => mockRedis),
  redisConnection: mockRedis,
  redis: mockRedis,
}));

vi.mock("../services/prisma.service.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../utils/logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      close: mockClose,
    })),
  },
}));

vi.mock("../queues/batch-email.queue.js", () => ({
  getEnqueuedEmailIds: vi.fn().mockResolvedValue(new Set<string>()),
}));

vi.mock("../services/credential-service.js", () => ({
  getCredentialSentCount: vi.fn().mockResolvedValue(5),
}));

import { sendSingleLeadImmediate } from "../services/email-service.js";
import { getLeadDeliveryDiagnostics } from "../services/lead-diagnostic.service.js";
import { sendMailWithFallback } from "../utils/credential-service.js";

// ----- Helpers -----

function makeLeadFixture(overrides: Record<string, any> = {}) {
  return {
    id: "lead-1",
    name: "John Doe",
    email: "john@example.com",
    stage: 0,
    status: "PENDING",
    sentAt: null,
    opened: 0,
    credId: null,
    created: new Date("2026-11-20T10:00:00Z"),
    updated: new Date("2026-11-20T10:00:00Z"),
    campaignId: "campaign-1",
    campaign: {
      id: "campaign-1",
      userId: "user-1",
      title: "Test Campaign",
      status: "RUNNING",
      maxStageCount: 3,
      daysInterval: 2,
      emailDeliveryPeriod: "ALL_DAY",
      activeDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
      isTrackingEnabled: false,
      user: {
        id: "user-1",
        email: "owner@test.com",
        name: "Sender Owner",
        credits: 50,
        timezone: "UTC",
      },
      pitches: [
        {
          id: "pitch-0",
          stage: 0,
          title: "Introduction",
          subject: "Hello {{name}}!",
          message: "Welcome to our platform {{name}}.",
        },
        {
          id: "pitch-1",
          stage: 1,
          title: "Follow up",
          subject: "Following up {{name}}!",
          message: "Just following up on my previous message.",
          delayDays: 2,
        },
      ],
      campaignEmailCredentials: [
        {
          emailCredential: {
            id: "cred-1",
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            username: "sender@gmail.com",
            password: "app-password",
            dailyLimit: 100,
          },
        },
      ],
    },
    cred: null,
    campaignMessages: [],
    campaignOpens: [],
    ...overrides,
  };
}

describe("Immediate Single Lead Sending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue({
      messageId: "<test-msg-123@smtp.gmail.com>",
      response: "250 2.0.0 OK",
    });
    mockPrisma.campaignMessage.findFirst.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.get.mockResolvedValue(null);
  });

  it("successfully sends an immediate test email to a selected lead without advancing stage", async () => {
    const lead = makeLeadFixture();
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
      userId: "user-1",
      isTestOnly: true, // Test mode
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("<test-msg-123@smtp.gmail.com>");
    expect(result.recipientEmail).toBe("john@example.com");
    expect(result.credentialUsed).toBe("sender@gmail.com");

    // Nodemailer sendMail was called
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailOpts = mockSendMail.mock.calls[0][0];
    expect(mailOpts.to).toBe("john@example.com");
    expect(mailOpts.subject).toBe("Hello John Doe!");
    expect(mailOpts.html).toContain("Welcome to our platform John Doe.");

    // Recorded in CampaignMessage
    expect(mockPrisma.campaignMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sent: true,
          messageId: "<test-msg-123@smtp.gmail.com>",
          campaignEmailId: "lead-1",
        }),
      }),
    );

    // Every sent email decrements 1 user credit
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { credits: { decrement: 1 } },
      select: { credits: true },
    });
    expect(mockPrisma.campaignEmail.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: {
        sentAt: expect.any(Date),
      },
    });
  });

  it("advances stage and decrements user credit when isTestOnly is false", async () => {
    const lead = makeLeadFixture();
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
      userId: "user-1",
      isTestOnly: false, // Campaign send mode
    });

    expect(result.success).toBe(true);
    expect(result.finalStatus).toBe("RUNNING");

    // Credits were decremented
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { credits: { decrement: 1 } },
      select: { credits: true },
    });

    // Stage was advanced from 0 to 1
    expect(mockPrisma.campaignEmail.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: {
        stage: 1,
        status: "RUNNING",
        sentAt: expect.any(Date),
      },
    });
  });

  it("rejects when user has 0 credits remaining", async () => {
    const lead = makeLeadFixture({
      campaign: {
        ...makeLeadFixture().campaign,
        user: { id: "user-1", email: "owner@example.com", credits: 0 },
      },
    });
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Credits depleted");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("rejects when campaign has no connected SMTP credentials", async () => {
    const lead = makeLeadFixture({
      campaign: {
        ...makeLeadFixture().campaign,
        campaignEmailCredentials: [],
      },
    });
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Missing SMTP credentials");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("rejects when lead does not exist", async () => {
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(null);

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "non-existent-lead",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Lead not found");
  });

  it("rejects unauthorized user trying to trigger someone else's campaign lead", async () => {
    const lead = makeLeadFixture();
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
      userId: "attacker-user-id",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Unauthorized");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("handles SMTP delivery failure gracefully and reports error details", async () => {
    const lead = makeLeadFixture();
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    mockSendMail.mockRejectedValueOnce(
      new Error("Invalid login: 535-5.7.8 Username and Password not accepted"),
    );

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
    });

    expect(result.success).toBe(false);
    expect(result.details).toContain("Invalid login");
    expect(result.finalStatus).toBe("FAILED");
  });

  it("strictly rejects sending when lead status is REPLIED (no chance to send even test)", async () => {
    const lead = makeLeadFixture({ status: "REPLIED" });
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
      isTestOnly: true,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Lead already replied");
    expect(result.finalStatus).toBe("REPLIED");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("strictly rejects sending when incoming reply message is detected in database", async () => {
    const lead = makeLeadFixture({ status: "PENDING" });
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);
    mockPrisma.campaignMessage.findFirst.mockResolvedValue({
      id: "reply-msg-1",
      sent: false,
      text: "Thanks, I am interested!",
    });

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Lead already replied");
    expect(result.finalStatus).toBe("REPLIED");
    expect(mockPrisma.campaignEmail.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { status: "REPLIED" },
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("blocks concurrent sends to the same lead when Redis lock is active", async () => {
    const lead = makeLeadFixture();
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);
    mockRedis.set.mockResolvedValueOnce(null); // Lock could not be acquired (already locked)

    const result = await sendSingleLeadImmediate({
      campaignId: "campaign-1",
      leadId: "lead-1",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Concurrent send in progress");
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("SMTP Port Fallback (465 <-> 587)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("automatically falls back to port 587 if port 465 times out", async () => {
    const timeoutError = new Error("Connection timeout");
    (timeoutError as any).code = "ETIMEDOUT";

    // Primary attempt on port 465 times out, fallback on port 587 succeeds
    mockSendMail
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({
        messageId: "<fallback-msg@smtp.gmail.com>",
        response: "250 2.0.0 OK",
      });

    const credential = {
      id: "c-1",
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      username: "user@gmail.com",
      password: "pwd",
    } as any;

    const result = await sendMailWithFallback(
      credential,
      { from: "user@gmail.com", to: "to@test.com", subject: "Hi", text: "Test" },
      "tx-fallback",
    );

    expect(result.messageId).toBe("<fallback-msg@smtp.gmail.com>");
    expect(result.portUsed).toBe(587);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });
});

describe("Lead Delivery Diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.campaignMessage.findFirst.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.get.mockResolvedValue(null);
  });

  it("returns complete diagnostic report with scheduler eligibility, mailbox, and timeline", async () => {
    const lead = makeLeadFixture({
      cred: {
        id: "cred-1",
        username: "ankit.iiits.07@gmail.com",
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        dailyLimit: 100,
      },
      campaignMessages: [
        {
          id: "m-1",
          messageId: "<msg-initial@gmail.com>",
          sent: true,
          created: new Date("2026-11-21T10:00:00Z"),
          pitch: { stage: 0, title: "Initial Email", subject: "Welcome" },
        },
      ],
      campaignOpens: [
        {
          id: "open-1",
          created: new Date("2026-11-21T12:00:00Z"),
        },
      ],
    });

    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    const diagnostics = await getLeadDeliveryDiagnostics("lead-1");

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.lead.email).toBe("john@example.com");
    expect(diagnostics?.lead.credEmail).toBe("ankit.iiits.07@gmail.com");
    expect(diagnostics?.schedulerEligibility.isEligible).toBe(true);
    expect(diagnostics?.schedulerEligibility.checks.campaignStatusOk).toBe(true);
    expect(diagnostics?.schedulerEligibility.checks.userCreditsOk).toBe(true);
    expect(diagnostics?.schedulerEligibility.checks.deliveryWindowOk).toBe(true);
    expect(diagnostics?.smtpCredential?.email).toBe("ankit.iiits.07@gmail.com");

    // History contains chronologically ordered events
    expect(diagnostics?.history.length).toBeGreaterThanOrEqual(3);
    expect(diagnostics?.history[0].event).toBe("Lead Added to Campaign");
    expect(diagnostics?.history[1].event).toBe("SMTP Mailbox Assigned");
    expect(diagnostics?.history[2].event).toBe("SMTP Email Dispatched");
  });

  it("identifies exact skip reason when lead is outside delivery window", async () => {
    const lead = makeLeadFixture({
      campaign: {
        ...makeLeadFixture().campaign,
        emailDeliveryPeriod: "MIDNIGHT", // 12 AM - 6 AM
        user: {
          id: "user-1",
          timezone: "UTC",
          credits: 10,
        },
      },
    });

    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    // Mock system time to 14:00 (outside 0-6 AM MIDNIGHT period)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T14:00:00Z"));

    const diagnostics = await getLeadDeliveryDiagnostics("lead-1");

    expect(diagnostics?.schedulerEligibility.isEligible).toBe(false);
    expect(diagnostics?.schedulerEligibility.skipReason).toContain("Outside configured delivery window 'MIDNIGHT'");

    vi.useRealTimers();
  });

  it("accurately detects replied lead, marks isReplied, and disables scheduler qualification", async () => {
    const lead = makeLeadFixture({
      status: "REPLIED",
      campaignMessages: [
        {
          id: "m-reply-1",
          messageId: "<inbound-reply@example.com>",
          sent: false,
          created: new Date("2026-11-22T10:00:00Z"),
          text: "I am interested in your product",
        },
      ],
    });

    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);

    const diagnostics = await getLeadDeliveryDiagnostics("lead-1");

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.lead.isReplied).toBe(true);
    expect(diagnostics?.lead.canSend).toBe(false);
    expect(diagnostics?.schedulerEligibility.isEligible).toBe(false);
    expect(diagnostics?.schedulerEligibility.checks.notReplied).toBe(false);
    expect(diagnostics?.schedulerEligibility.skipReason).toContain("Lead has already replied to this campaign");

    // History includes the incoming reply event
    const replyEvt = diagnostics?.history.find((h) => h.event === "Lead Replied to Campaign");
    expect(replyEvt).toBeDefined();
  });

  it("accurately detects active concurrency lock and flags in-progress send", async () => {
    const lead = makeLeadFixture();
    mockPrisma.campaignEmail.findUnique.mockResolvedValue(lead);
    mockRedis.get.mockResolvedValueOnce("tx-active-123"); // Active lock

    const diagnostics = await getLeadDeliveryDiagnostics("lead-1");

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.concurrency.isLocked).toBe(true);
    expect(diagnostics?.schedulerEligibility.isEligible).toBe(false);
    expect(diagnostics?.schedulerEligibility.checks.noConcurrentSend).toBe(false);
    expect(diagnostics?.schedulerEligibility.skipReason).toContain("concurrency lock active");
  });
});
