import { describe, expect, it } from "vitest";
import { assertGroupAccess } from "../src/lib/access-control";
import { ApiError } from "../src/lib/api-error";
import type { SessionUser } from "../src/lib/session-user";

function makeUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: "user-1",
    username: "user1",
    displayName: "User One",
    email: null,
    role: "superviseur",
    groupIds: [],
    groupNames: [],
    isActive: true,
    ...overrides,
  };
}

describe("assertGroupAccess", () => {
  it("laisse passer un superviseur qui appartient au groupe de la ressource", () => {
    const user = makeUser({ groupIds: ["group-a"] });
    expect(() => assertGroupAccess(user, "group-a")).not.toThrow();
  });

  it("rejette en 403 un superviseur du groupe A sur une ressource du groupe B", () => {
    const user = makeUser({ groupIds: ["group-a"] });
    try {
      assertGroupAccess(user, "group-b");
      throw new Error("aurait dû lever une ApiError 403");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
    }
  });

  it("rejette un superviseur sans aucun groupe", () => {
    const user = makeUser({ groupIds: [] });
    expect(() => assertGroupAccess(user, "group-b")).toThrow(ApiError);
  });

  it("laisse passer un administrateur quel que soit le groupe", () => {
    const user = makeUser({ role: "administrateur", groupIds: [] });
    expect(() => assertGroupAccess(user, "group-b")).not.toThrow();
  });

  it("laisse passer un approbateur quel que soit le groupe", () => {
    const user = makeUser({ role: "approbateur", groupIds: ["group-a"] });
    expect(() => assertGroupAccess(user, "group-b")).not.toThrow();
  });

  it("n'accorde pas l'accès sur simple préfixe/similarité d'id de groupe", () => {
    const user = makeUser({ groupIds: ["group-a"] });
    expect(() => assertGroupAccess(user, "group-a-extra")).toThrow(ApiError);
  });
});
