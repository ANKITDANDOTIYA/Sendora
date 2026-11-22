import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(),
      close: vi.fn(),
    })),
  },
}));

vi.mock("../utils/logger.js", () => ({
  log: vi.fn(),
}));

import nodemailer from "nodemailer";
import {
  normalizeSmtpConfig,
  setupEmailTransporters,
  removeTransporter,
  emailTransporters,
  getEmailTransporter,
} from "../utils/credential-service.js";

describe("Credential Service & SMTP Configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailTransporters.clear();
  });

  describe("normalizeSmtpConfig", () => {
    it("normalizes Gmail credential to smtp.gmail.com with port 465 and secure: true", () => {
      const config = normalizeSmtpConfig({
        id: "c-1",
        username: "user@gmail.com",
        password: "secretpassword",
        host: null as any,
        port: null as any,
        secure: false,
      } as any);

      expect(config.host).toBe("smtp.gmail.com");
      expect(config.port).toBe(465);
      expect(config.secure).toBe(true);
    });

    it("corrects port 587 when secure was mistakenly set to true", () => {
      const config = normalizeSmtpConfig({
        id: "c-2",
        username: "user@example.com",
        password: "secretpassword",
        host: "smtp.example.com",
        port: 587,
        secure: true, // Incorrect for 587
      } as any);

      expect(config.port).toBe(587);
      expect(config.secure).toBe(false);
    });

    it("corrects port 465 when secure was mistakenly set to false", () => {
      const config = normalizeSmtpConfig({
        id: "c-3",
        username: "user@example.com",
        password: "secretpassword",
        host: "smtp.example.com",
        port: 465,
        secure: false, // Incorrect for 465
      } as any);

      expect(config.port).toBe(465);
      expect(config.secure).toBe(true);
    });

    it("defaults standard host to port 465 secure: true when no port provided", () => {
      const config = normalizeSmtpConfig({
        id: "c-4",
        username: "user@domain.com",
        password: "pwd",
        host: "smtp.domain.com",
        port: null as any,
        secure: true,
      } as any);

      expect(config.port).toBe(465);
      expect(config.secure).toBe(true);
    });
  });

  describe("setupEmailTransporters", () => {
    it("configures transporter with cloud-ready timeouts (>= 30s) and TLS options", () => {
      setupEmailTransporters([
        {
          id: "cred-test",
          username: "ankit.iiits.07@gmail.com",
          password: "app-password",
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          dailyLimit: 50,
        } as any,
      ]);

      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
      const transportOpts = vi.mocked(nodemailer.createTransport).mock.calls[0][0] as any;

      expect(transportOpts.host).toBe("smtp.gmail.com");
      expect(transportOpts.port).toBe(465);
      expect(transportOpts.secure).toBe(true);
      expect(transportOpts.connectionTimeout).toBeGreaterThanOrEqual(30000);
      expect(transportOpts.greetingTimeout).toBeGreaterThanOrEqual(30000);
      expect(transportOpts.socketTimeout).toBeGreaterThanOrEqual(30000);
      expect(transportOpts.opportunisticTLS).toBeUndefined();
      expect(transportOpts.tls).toMatchObject({
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
      });
      expect(emailTransporters.has("cred-test")).toBe(true);
    });
  });

  describe("removeTransporter", () => {
    it("closes and removes transporter from memory pool", () => {
      const mockClose = vi.fn();
      emailTransporters.set("cred-remove", { close: mockClose } as any);

      removeTransporter("cred-remove");

      expect(mockClose).toHaveBeenCalled();
      expect(emailTransporters.has("cred-remove")).toBe(false);
      expect(getEmailTransporter("cred-remove")).toBeNull();
    });
  });
});

