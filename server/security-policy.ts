export type Principal = { id: string; tenantId: number | null; role: string; isActive: boolean };
type OwnedDocument = { userId: string | null; tenantId: number | null };
type RubricScope = { tenantId: number | null; isTemplate: boolean };
const academicRoles = new Set(["student", "doctoral_candidate", "chair", "committee_member"]);
const adminRoles = new Set(["program_admin", "security_admin", "super_admin"]);
export function ownsDocument(user: Principal, doc: OwnedDocument): boolean {
  return user.isActive && user.tenantId !== null && doc.tenantId === user.tenantId && doc.userId === user.id;
}
export function canReadRubric(user: Principal, rubric: RubricScope): boolean {
  return user.isActive && user.tenantId !== null &&
    (rubric.tenantId === user.tenantId || (rubric.tenantId === null && rubric.isTemplate));
}
export function canChangeRole(actor: Principal, target: Principal, nextRole: string): boolean {
  if (!actor.isActive || actor.tenantId === null || actor.tenantId !== target.tenantId || actor.id === target.id) return false;
  if (!adminRoles.has(actor.role)) return false;
  if (actor.role === "super_admin") return academicRoles.has(nextRole) || nextRole === "program_admin" || nextRole === "security_admin";
  return academicRoles.has(target.role) && academicRoles.has(nextRole);
}
/** Access tokens must declare their purpose and be bound to a server-side session (sid). */
export function tokenHasPurpose(payload: unknown, purpose: "access"): payload is { userId: string; type: "access"; sid: string } {
  if (!payload || typeof payload !== "object") return false;
  const claims = payload as Record<string, unknown>;
  return claims.type === purpose && typeof claims.userId === "string" && claims.userId.length > 0 &&
    typeof claims.sid === "string" && claims.sid.length > 0;
}
