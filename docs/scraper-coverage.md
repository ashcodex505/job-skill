# Scraper coverage audit

Baseline audit: 2026-08-15

Security/healthcare expansion verified: 2026-09-16

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

Workday has a recurring Saturday service window. During it, some CXS clusters
return an HTTP-200 HTML maintenance page instead of JSON. The adapter retries
that response and, when the window is active, records the affected company as
unscanned rather than failed or successfully empty. This avoids false health
issues and preserves existing board rows until the next successful scan.

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

## Security and healthcare expansion — 2026-09-16

All 17 companies in the [target catalog](../career/security-healthcare-targets.md)
have direct scheduled routes: Greenhouse, Ashby, Workday, or the dedicated
Throne public-HTML adapter. The catalog records careers URLs, exact endpoints,
raw posting counts, and research evidence. Palo Alto Networks, Vanta, and
Zscaler reuse existing registry entries; the other 14 are newly registered.
Throne is server-rendered and requires no local browser. Missing or incomplete
job-card markup raises a source error rather than silently closing jobs.

Baseten was added on 2026-09-18 through its public Ashby board (`baseten`),
which returned 99 raw postings during verification. It joins the scheduled
approved and priority scans; the normal new-grad and experience filters remain
in force for its inference, distributed-systems, infrastructure, and FDE roles.
Internships and co-ops are included for any season, including rolling or
unspecified dates, under the shared internship rules in `career/preferences.md`.

Cyera and Function Health are documented follow-up candidates, not enabled
sources: Comeet and Gem need verified adapters, and Function's legacy Breezy
board is empty despite current openings on Gem. Existing manual/browser
coverage above is unchanged by this expansion.

The current role policy also includes junior and Engineer I / 1 technical roles,
including AI/ML and distributed systems. `Internship seasons: Any` accepts every
season and unstated dates while retaining the Summer 2027 company restriction.
Workday's targeted searches include entry-level, junior, and level-I terms so
these roles can reach the eligibility filter. Counts in the research catalog
reflect the earlier verification run and its narrower search terms.
