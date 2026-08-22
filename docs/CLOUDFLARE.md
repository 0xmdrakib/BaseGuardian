# Cloudflare protection for Base Guardian

Base Guardian uses the existing Cloudflare proxy as its shared edge protection
and keeps a dependency-free, per-instance limiter inside the Vercel app. No
Arcjet, Redis, or additional security service is required.

## Required DNS setting

In **Cloudflare > DNS > Records**, keep the production web record set to
**Proxied** (orange cloud). A DNS-only record bypasses Cloudflare security.

The public `*.vercel.app` deployment URL can still bypass Cloudflare. Do not
publish it as the app URL; use the Cloudflare-proxied custom domain everywhere.

## Free-plan rate-limit rule

Cloudflare Free currently provides one rate-limiting rule. Create it from
**Security > Security rules > Create rule > Rate limiting rules**:

- Rule name: `Protect Base API`
- Field: `URI Path`
- Operator: `starts with`
- Value: `/api/base/`
- Requests: `6`
- Period: `10 seconds`
- Characteristics: `IP`
- Also apply rate limiting to cached assets: `Off`
- Action: `Block`
- Mitigation timeout: `10 seconds`
- Deploy the rule

Six requests per ten seconds allows normal scans while stopping sustained spam.
`Block` is intentional: browser API calls receive a normal rate-limit response
instead of an interactive CAPTCHA/challenge that would break the scan flow.
The application separately enforces 30 requests/minute and 300 requests/hour per
IP, plus endpoint-specific limits. Because Vercel instances do not share memory,
the Cloudflare rule is the primary distributed limit and the application rule is
a fallback.

## WAF baseline

In **Security > WAF > Managed rules**, enable the **Cloudflare Free Managed
Ruleset**. Leave Cloudflare's automatic DDoS protection enabled.

After deployment, confirm a normal wallet scan works and inspect **Security >
Analytics > Events** before making the edge limit stricter.
