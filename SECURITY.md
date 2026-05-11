# Security Policy

## Reporting a vulnerability

If you believe you've found a security issue in Pilates — anything from a
denial-of-service via crafted input to a cross-package privilege escalation
— please **do not open a public GitHub issue**. Public reports give an
unbounded window between disclosure and a fix landing on users.

Report it privately via one of:

- **GitHub Security Advisories** (preferred):
  <https://github.com/pilatesjs/pilates/security/advisories/new>
- **Email**: wangzhijie19950807@gmail.com

Include, when possible:

- A description of the issue and its impact
- A minimal reproduction (test case, stack trace, or POC)
- The affected package(s) and version(s)
- Your suggested remediation, if any

You should expect an acknowledgement within **72 hours** and an initial
assessment within **7 days**. After remediation, you'll be credited (with
your permission) in the release notes and CHANGELOG.

## Supported versions

Pilates packages follow Semantic Versioning. Security fixes land on the
latest minor of each package; older minors receive backports only if the
fix cannot be applied to current code without a breaking change. The
currently-supported versions are:

| Package | Version | Status |
|---|---|---|
| `@pilates/core` | `1.x` | Active |
| `@pilates/render` | `1.x` | Active |
| `@pilates/react` | `0.x` | Active (pre-1.0) |
| `@pilates/diff` | `0.x` | Active (pre-1.0) |
| `@pilates/widgets` | `0.x` | Active (pre-1.0) |

Pre-1.0 packages may receive breaking changes alongside security fixes if
they are the cleanest path to remediation.

## Scope

In scope:

- Code paths reachable from public APIs of any `@pilates/*` package
- Build / publish supply chain (the `pnpm publish` flow)
- Documented examples under `examples/`

Out of scope:

- Issues in third-party packages we depend on — please report those
  upstream. We track our prod-dep vulns via `pnpm audit` and Dependabot
- Issues exclusively in development tooling (test runners, lint configs)
  unless they affect what ships in the npm tarball
