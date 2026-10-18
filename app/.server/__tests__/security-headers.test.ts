import { describe, expect, it } from "vitest";
import { baseSecurityHeaders, contentSecurityPolicy } from "../security-headers";

describe("contentSecurityPolicy", () => {
    const policy = (nonce = "abc123") => Object.fromEntries(contentSecurityPolicy(nonce).split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

    it("only runs scripts from this site or carrying the request's nonce", () => {
        expect(policy("abc123")["script-src"]).toEqual(["'self'", "'nonce-abc123'"]);
    });

    it("never allows inline or eval scripts", () => {
        const scripts = policy()["script-src"].join(" ");

        expect(scripts).not.toContain("unsafe-inline");
        expect(scripts).not.toContain("unsafe-eval");
    });

    it("blocks framing, plugins, base-tag hijacking and cross-site form posts", () => {
        const p = policy();

        expect(p["frame-ancestors"]).toEqual(["'none'"]);
        expect(p["object-src"]).toEqual(["'none'"]);
        expect(p["base-uri"]).toEqual(["'self'"]);
        expect(p["form-action"]).toEqual(["'self'"]);
    });

    it("keeps everything else on this site, except Google Fonts", () => {
        const p = policy();

        expect(p["default-src"]).toEqual(["'self'"]);
        expect(p["connect-src"]).toEqual(["'self'"]);
        expect(p["style-src"]).toContain("https://fonts.googleapis.com");
        expect(p["font-src"]).toContain("https://fonts.gstatic.com");
    });

    it("uses a different policy for a different nonce", () => {
        expect(contentSecurityPolicy("one")).not.toBe(contentSecurityPolicy("two"));
    });
});

describe("baseSecurityHeaders", () => {
    it("always stops sniffing, framing and over-sharing", () => {
        expect(baseSecurityHeaders({ secure: false })).toMatchObject({
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Cross-Origin-Opener-Policy": "same-origin",
        });
    });

    it("turns off the camera, microphone and location", () => {
        expect(baseSecurityHeaders({ secure: false })["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
    });

    it("sends HSTS only over HTTPS", () => {
        expect(baseSecurityHeaders({ secure: false })).not.toHaveProperty("Strict-Transport-Security");
        expect(baseSecurityHeaders({ secure: true })["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    });
});
