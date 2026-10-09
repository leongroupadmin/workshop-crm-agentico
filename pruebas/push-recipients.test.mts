import assert from "node:assert/strict";
import test from "node:test";

import { handoffRecipientIds, type PushMember } from "../src/lib/push-recipients.ts";

const members: PushMember[] = [
  { user_id: "owner", role: "owner", permissions: null },
  { user_id: "admin", role: "admin", permissions: {} },
  {
    user_id: "available-agent",
    role: "agent",
    permissions: { ver_leads_sin_asignar: true, responder_chats: true },
  },
  {
    user_id: "read-only-agent",
    role: "agent",
    permissions: { ver_leads_sin_asignar: true },
  },
  { user_id: "assigned-agent", role: "agent", permissions: {} },
];

test("un lead asignado avisa solamente a su responsable", () => {
  assert.deepEqual(handoffRecipientIds(members, "assigned-agent"), ["assigned-agent"]);
});

test("un lead sin asignar avisa a administradores y operarios que pueden atenderlo", () => {
  assert.deepEqual(handoffRecipientIds(members, null), ["owner", "admin", "available-agent"]);
});

test("ver el lead sin poder responder no alcanza para recibir avisos", () => {
  assert.equal(handoffRecipientIds(members, null).includes("read-only-agent"), false);
});
