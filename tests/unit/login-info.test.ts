import { describe, expect, it } from "vitest";
import { describeDevice, networkLocation, readGeo } from "@/lib/login-info";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};

describe("login location helpers", () => {
  it("names the device in plain words", () => {
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Android 14 · Chrome");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36")).toBe("Android 13 · Samsung Internet");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Windows · Edge");
    expect(describeDevice(null)).toBe("Unknown device");
  });

  it("reads GPS from the login form, or why it is missing", () => {
    expect(readGeo(form({ lat: "6.6018", lng: "3.3515", accuracy: "12.5" }))).toEqual({ lat: 6.6018, lng: 3.3515, accuracy: 12.5 });
    expect(readGeo(form({ geo_error: "denied" }))).toEqual({ location_error: "denied" });
    expect(readGeo(form({}))).toEqual({ location_error: "not_shared" });
    expect(readGeo(form({ lat: "999", lng: "3" }))).toEqual({ location_error: "not_shared" }); // not a real place
    expect(readGeo(form({ lat: "abc", lng: "3" }))).toEqual({ location_error: "not_shared" });
  });

  it("reads Vercel's network location headers", () => {
    const h = new Headers({ "x-forwarded-for": "102.89.1.2, 10.0.0.1", "x-vercel-ip-city": "Ikeja", "x-vercel-ip-country-region": "LA", "x-vercel-ip-country": "NG" });
    expect(networkLocation(h)).toEqual({ ip: "102.89.1.2", city: "Ikeja", region: "LA", country: "NG" });
    expect(networkLocation(new Headers())).toEqual({ ip: undefined, city: undefined, region: undefined, country: undefined });
  });
});
