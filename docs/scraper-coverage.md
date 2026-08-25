# Scraper coverage audit

Last audited: 2026-08-15

Run `npm run scrape:coverage` for the current generated summary. The monthly
registry check also writes this report to its GitHub Actions run summary; it
does not create a coverage issue or notify the repository owner.

## Coverage policy

- **Direct** sources run in the scheduled watcher through a public,
  unauthenticated company or ATS endpoint.
- **Browser** sources run only on the local machine while the dashboard is
  open. They never run in GitHub Actions.
- **Community-feed** sources have a confirmed feed fallback, but coverage is
  not guaranteed because the company does not expose a usable direct source.
- **Manual** sources have no stable automated route that this project can use
  without authentication, anti-bot bypasses, or company-specific interaction.

Every approved company must have a registry entry and every unsupported entry
must declare a fallback. Tests fail if either invariant is broken.

## Direct adapters added in this audit

The following companies expose verified public Workday CXS endpoints and are
now included in scheduled watch scans:

- Autodesk (`autodesk.wd1.myworkdayjobs.com`, site `Ext`)
- Expedia (`expedia.wd108.myworkdayjobs.com`, site `search`)
- HP (`hp.wd5.myworkdayjobs.com`, site `ExternalCareerSite`)
- Qualcomm (`qualcomm.wd12.myworkdayjobs.com`, site `External`)
- Yahoo (`ouryahoo.wd5.myworkdayjobs.com`, site `careers`)
- Zoom (`zoom.wd5.myworkdayjobs.com`, site `Zoom`)

Each endpoint was probed with the same targeted Workday requests used by the
production adapter. Qualcomm returned a valid response with zero current
matches; zero is reported as a registry warning rather than treated as a
source failure.

## Remaining non-direct sources

### Local browser scan

Apple, Bloomberg, Google, IBM, Meta, Microsoft, Snowflake, TikTok, and Two
Sigma are protected or session-rendered and already have local browser-scan
configuration.

### Confirmed community-feed fallback

Jane Street and Tesla currently appear in the configured community feeds.
This is useful but not equivalent to first-party coverage.

### Manual-only after audit

| Company | Why no direct adapter was added |
|---|---|
| Booking.com | Careers endpoint rejects plain HTTP access and no stable public ATS endpoint was verified. |
| Cisco | Current Phenom site is session/widget driven; anonymous widget search did not return a stable job payload suitable for CI. |
| Citadel | Edge protection blocks plain requests and the rendered site does not expose a stable listing feed. |
| Grammarly | Careers now redirects to Superhuman and the linked legacy Grammarly Greenhouse board is inactive. |
| HashiCorp | Careers endpoint is rate-limited and no independent public HashiCorp board was verified after the IBM acquisition. |
| Intuit | TalentBrew/Radancy search is company-specific and no stable public listing API was verified. |
| LinkedIn | Genuine listings require an authenticated LinkedIn session. |
| SAP | The SuccessFactors-backed site requires company-specific state that the existing adapters do not support safely. |
| Splunk | Listings now live inside Cisco's Phenom site and inherit the same session/widget limitation. |
| Uber | The public experience is interaction-driven and did not expose a stable anonymous listing API. |
| VMware | Careers now points to Broadcom and cannot be safely scoped to VMware roles through a public endpoint. |
| Wiz | Current careers page routes job discovery to LinkedIn rather than a public ATS board. |
| X (Twitter) | No stable public X jobs endpoint was verified; the observed careers route is edge-protected. |

These sources must not be “supported” using guessed tenant names or HTML
selectors that silently return incomplete results. They should move to direct
coverage only after a reproducible public endpoint and pagination behavior are
verified.
