import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, pool, rpc } from "./helpers";

let staff: string;
beforeAll(async () => {
  staff = await createUser("staff", "Amaka");
});
afterAll(() => pool.end());

const last = async () =>
  (await pool.query("select action, details from public.audit_log where actor_id = $1 order by id desc limit 1", [staff])).rows[0];

describe("login location in the audit log", () => {
  it("keeps device, network location and GPS", async () => {
    await rpc(staff, "select public.log_auth_event('login', $1)", [
      { device: "Android 14 · Chrome", ip: "102.89.1.2", city: "Ikeja", country: "NG", lat: 6.6018123456, lng: 3.3515, accuracy: 12.4 },
    ]);
    expect(await last()).toEqual({
      action: "login",
      details: { device: "Android 14 · Chrome", ip: "102.89.1.2", city: "Ikeja", country: "NG", lat: 6.601812, lng: 3.3515, accuracy: 12 },
    });
  });

  it("drops anything else the phone sends, trims long text and ignores impossible coordinates", async () => {
    await rpc(staff, "select public.log_auth_event('login_blocked_location', $1)", [
      { location_error: "denied", device: "x".repeat(500), lat: 500, lng: 3, role: "admin", evil: { nested: true } },
    ]);
    const row = await last();
    expect(row.action).toBe("login_blocked_location");
    expect(Object.keys(row.details).sort()).toEqual(["device", "location_error"]);
    expect(row.details.device).toHaveLength(120);
  });

  it("only allows known login events", async () => {
    await expect(rpc(staff, "select public.log_auth_event('sale_void', '{}')")).rejects.toThrow(/INVALID_ACTION/);
    await expect(rpc(null, "select public.log_auth_event('login', '{}')")).rejects.toThrow(/permission denied/);
  });
});
