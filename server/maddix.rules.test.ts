import { describe, expect, it } from "vitest";
import { canTransitionOrderStatus, hashPassword, verifyPassword } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

describe("Maddix local authentication", () => {
  it("stores and verifies the seeded admin password as a one-way hash", () => {
    const hash = hashPassword("abdo");
    expect(hash).not.toContain("abdo");
    expect(verifyPassword("abdo", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("does not expose the admin password as stored text", () => {
    expect(hashPassword("abdo")).not.toBe("abdo");
  });
});

describe("Maddix order state machine", () => {
  it("allows only valid forward warehouse transitions", () => {
    expect(canTransitionOrderStatus("NEW", "PROCESSING")).toBe(true);
    expect(canTransitionOrderStatus("PROCESSING", "READY")).toBe(true);
    expect(canTransitionOrderStatus("READY", "DELIVERED")).toBe(true);
    expect(canTransitionOrderStatus("DELIVERED", "NEW")).toBe(false);
    expect(canTransitionOrderStatus("REJECTED", "PROCESSING")).toBe(false);
  });
});

describe("Maddix admin authorization", () => {
  it("rejects material creation for ordinary users before database access", async () => {
    const user = { id: 22, openId: "local-user", name: "مستخدم", email: "user@example.com", username: "user", passwordHash: null, loginMethod: "password", role: "user" as const, active: 1, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
    const ctx: TrpcContext = { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
    const caller = appRouter.createCaller(ctx);
    await expect(caller.materials.create({ name: "اختبار", unit: "كيلو", category: "اختبار", description: "", allowDecimal: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
