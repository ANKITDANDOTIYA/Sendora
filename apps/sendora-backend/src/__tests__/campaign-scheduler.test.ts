import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks
const mockUpsertJobScheduler = vi.fn();
const mockGetJobSchedulers = vi.fn();

vi.mock("../config/redis.js", () => {
  const mockRedis = {
    on: vi.fn(),
    status: "ready",
  };
  class MockQueue {
    name: string;
    opts: any;
    constructor(name: string, opts: any) {
      this.name = name;
      this.opts = opts;
    }
    upsertJobScheduler = mockUpsertJobScheduler;
    getJobSchedulers = mockGetJobSchedulers;
  }
  return {
    Queue: MockQueue,
    Worker: vi.fn(),
    createRedisClient: vi.fn(() => mockRedis),
    redisConnection: mockRedis,
    redis: mockRedis,
  };
});

describe("Campaign Scheduler Initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the recurring campaign scheduler with BullMQ using the hourly cron pattern", async () => {
    mockUpsertJobScheduler.mockResolvedValueOnce({ id: "email-scheduler" });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { initializeCampaignScheduler, campaignQueue } = await import(
      "../queues/campaign.queue.js"
    );

    // Queue name must be campaignQueue
    expect(campaignQueue.name).toBe("campaignQueue");

    await initializeCampaignScheduler();

    // Verify upsertJobScheduler was called with exact parameters
    expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
      "email-scheduler",
      { pattern: "0 * * * *" },
      {
        name: "campaign-queue",
        opts: {
          backoff: 3,
          attempts: 5,
          removeOnFail: 1000,
        },
      },
    );

    // Verify startup logs
    expect(consoleSpy).toHaveBeenCalledWith(
      "[STARTUP] Initializing campaign scheduler...",
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[STARTUP] Campaign scheduler registered successfully",
      ),
    );

    consoleSpy.mockRestore();
  });

  it("handles scheduler registration failure by logging and re-throwing the error", async () => {
    const error = new Error("Redis connection timed out");
    mockUpsertJobScheduler.mockRejectedValueOnce(error);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { initializeCampaignScheduler } = await import(
      "../queues/campaign.queue.js"
    );

    await expect(initializeCampaignScheduler()).rejects.toThrow(
      "Redis connection timed out",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[STARTUP] Failed to register campaign scheduler 'email-scheduler':",
      "Redis connection timed out",
    );

    consoleErrorSpy.mockRestore();
  });

  it("guarantees idempotency by using the stable scheduler ID 'email-scheduler'", async () => {
    mockUpsertJobScheduler.mockResolvedValue({ id: "email-scheduler" });

    const { initializeCampaignScheduler } = await import(
      "../queues/campaign.queue.js"
    );

    // Simulate two backend instances starting up simultaneously
    await initializeCampaignScheduler();
    await initializeCampaignScheduler();

    expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(2);
    // Both calls target the exact same scheduler ID, so Redis upserts without duplicate jobs
    expect(mockUpsertJobScheduler.mock.calls[0][0]).toBe("email-scheduler");
    expect(mockUpsertJobScheduler.mock.calls[1][0]).toBe("email-scheduler");
  });

  it("initializes IMAP scheduler with 10-minute cron pattern", async () => {
    mockUpsertJobScheduler.mockResolvedValueOnce({ id: "imap-scheduler" });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { initializeImapScheduler, imapQueue } = await import(
      "../queues/imap.queue.js"
    );

    expect(imapQueue.name).toBe("imapQueue");

    await initializeImapScheduler();

    expect(mockUpsertJobScheduler).toHaveBeenCalledWith("imap-scheduler", {
      pattern: "*/10 * * * *",
    });

    consoleSpy.mockRestore();
  });
});

