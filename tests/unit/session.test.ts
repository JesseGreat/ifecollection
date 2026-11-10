import { describe, expect, it } from "vitest";
import { closingState, gateDecision, type SessionStatus } from "@/lib/session";

const staff = (over: Partial<SessionStatus> = {}): SessionStatus => ({
  signed_in: true, found: true, active: true, role: "staff", within_hours: true, allowed: true, ...over,
});
const admin = (over: Partial<SessionStatus> = {}): SessionStatus => staff({ role: "admin", ...over });

describe("gateDecision (runs in proxy.ts on every request)", () => {
  it("sends logged-out users to login, but lets them see the login page", () => {
    expect(gateDecision(null, "/sell")).toEqual({ kind: "redirect", to: "/login", signOut: false });
    expect(gateDecision(null, "/login")).toEqual({ kind: "allow" });
    expect(gateDecision({ signed_in: false }, "/admin")).toMatchObject({ to: "/login" });
  });

  it("before 8am / after 8pm (server says outside hours): staff are signed out with the closed message", () => {
    for (const path of ["/sell", "/my-sales", "/receipt/x", "/login", "/"]) {
      expect(gateDecision(staff({ within_hours: false, allowed: false }), path)).toEqual({
        kind: "redirect",
        to: "/login?reason=closed",
        signOut: true,
      });
    }
  });

  it("during hours: staff can use staff pages, but not admin pages", () => {
    expect(gateDecision(staff(), "/sell")).toEqual({ kind: "allow" });
    expect(gateDecision(staff(), "/receipt/abc")).toEqual({ kind: "allow" });
    expect(gateDecision(staff(), "/admin")).toEqual({ kind: "redirect", to: "/sell", signOut: false });
    expect(gateDecision(staff(), "/admin/products/new")).toMatchObject({ to: "/sell" });
    expect(gateDecision(staff(), "/")).toMatchObject({ to: "/sell" });
  });

  it("admin is never time-restricted", () => {
    expect(gateDecision(admin({ within_hours: false }), "/admin")).toEqual({ kind: "allow" });
    expect(gateDecision(admin({ within_hours: false }), "/sell")).toEqual({ kind: "allow" });
    expect(gateDecision(admin(), "/login")).toMatchObject({ to: "/admin" });
  });

  it("a device replaced by a newer login (one device per account) is signed out, admin too", () => {
    expect(gateDecision(staff({ replaced: true, allowed: false }), "/sell")).toEqual({
      kind: "redirect",
      to: "/login?reason=elsewhere",
      signOut: true,
    });
    expect(gateDecision(admin({ replaced: true, allowed: false }), "/admin")).toMatchObject({ to: "/login?reason=elsewhere" });
  });

  it("deactivated accounts are signed out", () => {
    expect(gateDecision(staff({ active: false }), "/sell")).toEqual({ kind: "redirect", to: "/login?reason=inactive", signOut: true });
    expect(gateDecision(admin({ active: false }), "/admin")).toMatchObject({ signOut: true });
    expect(gateDecision(staff({ found: false }), "/sell")).toMatchObject({ signOut: true });
  });
});

describe("closingState (countdown on the phone)", () => {
  // Server said at 19:40:00 that closing is in 20 minutes (1200s). Warning at 10 minutes.
  const fromServer = 1200;
  const at = (mmss: string) => {
    const [m, s] = mmss.split(":").map(Number);
    return ((m - 40) * 60 + s) * 1000; // elapsed ms since 19:40:00
  };

  it("open (no warning) before 19:50", () => {
    expect(closingState(fromServer, 10, at("40:00"))).toEqual({ phase: "open" });
    expect(closingState(fromServer, 10, at("49:59"))).toEqual({ phase: "open" });
  });

  it("warning with a countdown from 19:50", () => {
    expect(closingState(fromServer, 10, at("50:00"))).toEqual({ phase: "warning", secondsLeft: 600 });
    expect(closingState(fromServer, 10, at("59:30"))).toEqual({ phase: "warning", secondsLeft: 30 });
  });

  it("closed at 20:00 – a session that crosses 8pm is ended", () => {
    expect(closingState(fromServer, 10, 1200_000)).toEqual({ phase: "closed" });
    expect(closingState(fromServer, 10, 1500_000)).toEqual({ phase: "closed" });
  });

  it("uses elapsed time only, so a wrong phone clock does not matter; admin (null) never closes", () => {
    expect(closingState(null, 10, 99_999_999)).toEqual({ phase: "open" });
  });
});
