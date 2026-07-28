import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACTION_PERMISSION,
  AUDIT_ACTIONS,
  ROLES,
  can,
  isAuditAction,
  isRole,
  parseAdminRoles,
  permissionsFor,
  roleFor,
  type Permission,
} from "./rbac.ts";

test("an unsuffixed number is an owner", () => {
  // A one-person shop sets one number and expects to do everything. A default
  // that quietly removed the GST desk from the only configured account would be
  // a worse surprise than a permissive default.
  const roles = parseAdminRoles("9876543210");
  assert.equal(roleFor("9876543210", roles), "owner");
});

test("reads a role off the number", () => {
  const roles = parseAdminRoles("9876543210:viewer,9812340001:operator");
  assert.equal(roleFor("9876543210", roles), "viewer");
  assert.equal(roleFor("9812340001", roles), "operator");
});

test("keeps a number written with a country code or a leading zero", () => {
  // The same person typed three ways is still one operator, and dropping any of
  // them silently locks somebody out.
  const roles = parseAdminRoles("+91 98765 43210:operator, 09812340001:viewer");
  assert.equal(roleFor("9876543210", roles), "operator");
  assert.equal(roleFor("9812340001", roles), "viewer");
});

test("drops a misspelled role rather than guessing one", () => {
  // ':oprator' is a typo. Granting the least privilege would look like a
  // permissions bug for as long as it took somebody to notice; granting the
  // most would be a hole. Neither: the entry does not exist.
  const roles = parseAdminRoles("9876543210:oprator");
  assert.equal(roleFor("9876543210", roles), undefined);
});

test("treats no configuration as nobody, not everybody", () => {
  assert.equal(parseAdminRoles(undefined).size, 0);
  assert.equal(parseAdminRoles("").size, 0);
  assert.equal(roleFor("9876543210", parseAdminRoles("")), undefined);
});

test("keeps a packer away from the things that cannot be undone", () => {
  assert.equal(can("operator", "orders:write"), true);
  assert.equal(can("operator", "remittance:write"), true);
  // Erasing a customer is irreversible, and a GSTR-1 export is every
  // customer's state and every registered buyer's GSTIN in one file.
  assert.equal(can("operator", "privacy:write"), false);
  assert.equal(can("operator", "gst:read"), false);
});

test("a viewer can look and nothing else", () => {
  assert.equal(can("viewer", "metrics:read"), true);
  for (const permission of [
    "orders:write",
    "remittance:write",
    "gst:read",
    "privacy:write",
  ] as Permission[]) {
    assert.equal(can("viewer", permission), false, permission);
  }
});

test("nobody without a role can do anything", () => {
  // The signed-in shopper case. `can(undefined, …)` has to be false or every
  // gate that forgets to check for a role first is open.
  for (const permission of [
    "metrics:read",
    "orders:write",
    "privacy:write",
  ] as Permission[]) {
    assert.equal(can(undefined, permission), false, permission);
  }
});

test("an owner holds every permission the roles below do", () => {
  // Written out per role rather than as a hierarchy, so this is a property
  // worth checking rather than one the structure guarantees.
  for (const role of ROLES) {
    for (const permission of permissionsFor(role)) {
      assert.equal(can("owner", permission), true, `${role}: ${permission}`);
    }
  }
});

test("every recordable action names the permission it needs", () => {
  // The log and the gate cannot drift: an action nobody can map to a permission
  // is an action nobody is sure was authorised.
  for (const action of AUDIT_ACTIONS) {
    assert.ok(ACTION_PERMISSION[action], action);
    assert.ok(isAuditAction(action));
  }
  assert.equal(isAuditAction("order.delete"), false);
});

test("refuses a role name that is not one", () => {
  assert.equal(isRole("owner"), true);
  assert.equal(isRole("admin"), false);
  assert.equal(isRole(""), false);
});
