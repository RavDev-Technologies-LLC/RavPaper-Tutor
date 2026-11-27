import { test } from "node:test";
import assert from "node:assert/strict";
import { ownsDocument, canReadRubric, canChangeRole, tokenHasPurpose } from "../server/security-policy.ts";
const student = { id: "a", tenantId: 1, role: "student", isActive: true };
const chair = { ...student, role: "chair" };
const admin = { ...student, role: "program_admin" };
const other = { ...student, id: "b" };
test("owner is authorized only within their tenant", () => {
  assert.equal(ownsDocument(student, { userId: "a", tenantId: 1 }), true);
  assert.equal(ownsDocument(student, { userId: "a", tenantId: 2 }), false);
  assert.equal(ownsDocument(chair, { userId: "b", tenantId: 1 }), false);
  assert.equal(ownsDocument(admin, { userId: "b", tenantId: 2 }), false);
  assert.equal(ownsDocument({ ...student, tenantId: null }, { userId: "a", tenantId: null }), false);
});
test("disabled principal cannot access documents", () => {
  assert.equal(ownsDocument({ ...student, isActive: false }, { userId: "a", tenantId: 1 }), false);
});
test("rubrics are private unless explicitly global", () => {
  assert.equal(canReadRubric(student, { tenantId: 1, isTemplate: false }), true);
  assert.equal(canReadRubric(student, { tenantId: 2, isTemplate: true }), false);
  assert.equal(canReadRubric(student, { tenantId: null, isTemplate: true }), true);
  assert.equal(canReadRubric(student, { tenantId: null, isTemplate: false }), false);
});
test("role changes reject self-promotion and cross-tenant requests", () => {
  assert.equal(canChangeRole(admin, admin, "super_admin"), false);
  assert.equal(canChangeRole(admin, { ...other, tenantId: 2 }, "chair"), false);
  assert.equal(canChangeRole(admin, other, "super_admin"), false);
  assert.equal(canChangeRole(admin, { ...other, role: "security_admin" }, "student"), false);
  assert.equal(canChangeRole(admin, other, "chair"), true);
  assert.equal(canChangeRole(student, other, "chair"), false);
});
test("access tokens require purpose and a bound session id", () => {
  assert.equal(tokenHasPurpose({ userId: "a", type: "refresh", sid: "s" }, "access"), false);
  assert.equal(tokenHasPurpose({ userId: "a", type: "access", sid: "s" }, "access"), true);
  assert.equal(tokenHasPurpose({ userId: "a", type: "access" }, "access"), false);
  assert.equal(tokenHasPurpose({ userId: "a", type: "access", sid: "" }, "access"), false);
  assert.equal(tokenHasPurpose({ userId: "a" }, "access"), false);
  assert.equal(tokenHasPurpose("invalid", "access"), false);
  assert.equal(tokenHasPurpose({ userId: 1, type: "access", sid: "s" }, "access"), false);
});
