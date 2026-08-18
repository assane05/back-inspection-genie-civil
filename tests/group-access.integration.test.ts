import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { prisma } from "../src/prisma";
import { hashPassword } from "../src/lib/password";

describe("contrôle d'accès par groupe — inter-groupes", () => {
  const suffix = randomUUID().slice(0, 8);
  const password = "TestOnly123!";

  let groupAId: string;
  let groupBId: string;
  let formTypeId: string;
  let assignmentBId: string;
  let inspectionBId: string;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    const groupA = await prisma.group.create({
      data: { name: `Test Group A ${suffix}` },
    });
    const groupB = await prisma.group.create({
      data: { name: `Test Group B ${suffix}` },
    });
    groupAId = groupA.id;
    groupBId = groupB.id;

    const formType = await prisma.formType.create({
      data: {
        code: `test-group-access-${suffix}`,
        name: "Fiche de test",
        module: "horizontal",
      },
    });
    formTypeId = formType.id;

    const passwordHash = await hashPassword(password);
    const userA = await prisma.user.create({
      data: {
        username: `test-user-a-${suffix}`,
        displayName: "Test User A",
        passwordHash,
        role: "superviseur",
      },
    });
    const userB = await prisma.user.create({
      data: {
        username: `test-user-b-${suffix}`,
        displayName: "Test User B",
        passwordHash,
        role: "superviseur",
      },
    });
    await prisma.userGroup.create({
      data: { userId: userA.id, groupId: groupAId },
    });
    await prisma.userGroup.create({
      data: { userId: userB.id, groupId: groupBId },
    });

    const assignmentB = await prisma.assignment.create({
      data: { formTypeId, groupId: groupBId, year: 2026, bimonthlyPeriod: 1 },
    });
    assignmentBId = assignmentB.id;
    const inspectionB = await prisma.inspection.create({
      data: { assignmentId: assignmentBId, formTypeId, groupId: groupBId },
    });
    inspectionBId = inspectionB.id;

    const loginA = await request(app)
      .post("/auth/login")
      .send({ identifier: userA.username, password });
    cookieA = loginA.headers["set-cookie"][0];

    const loginB = await request(app)
      .post("/auth/login")
      .send({ identifier: userB.username, password });
    cookieB = loginB.headers["set-cookie"][0];
  });

  afterAll(async () => {
    await prisma.inspection.deleteMany({
      where: { groupId: { in: [groupAId, groupBId] } },
    });
    await prisma.assignment.deleteMany({
      where: { groupId: { in: [groupAId, groupBId] } },
    });
    await prisma.userGroup.deleteMany({
      where: { groupId: { in: [groupAId, groupBId] } },
    });
    await prisma.user.deleteMany({
      where: {
        username: { in: [`test-user-a-${suffix}`, `test-user-b-${suffix}`] },
      },
    });
    await prisma.formType.delete({ where: { id: formTypeId } });
    await prisma.group.deleteMany({
      where: { id: { in: [groupAId, groupBId] } },
    });
    await prisma.$disconnect();
  });

  it("(témoin positif) le groupe B accède à sa propre inspection", async () => {
    const res = await request(app)
      .get(`/api/inspections/${inspectionBId}`)
      .set("Cookie", cookieB);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(inspectionBId);
  });

  it("le groupe A reçoit 403 sur une inspection du groupe B", async () => {
    const res = await request(app)
      .get(`/api/inspections/${inspectionBId}`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(403);
  });

  it("le groupe A reçoit 403 en écriture (PATCH values) sur une inspection du groupe B", async () => {
    const res = await request(app)
      .patch(`/api/inspections/${inspectionBId}/values`)
      .set("Cookie", cookieA)
      .send({ values: [{ itemId: randomUUID(), state: "ras" }] });
    expect(res.status).toBe(403);
  });

  it("le groupe A reçoit 403 en création d'inspection sur une assignation du groupe B", async () => {
    const res = await request(app)
      .post(`/api/assignments/${assignmentBId}/inspection`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(403);
  });

  it("la liste des assignations du groupe A ne contient pas celle du groupe B", async () => {
    const res = await request(app)
      .get("/api/assignments")
      .set("Cookie", cookieA);
    expect(res.status).toBe(200);
    const ids = res.body.assignments.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(assignmentBId);
  });
});
