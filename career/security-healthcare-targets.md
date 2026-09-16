# Security and healthcare company targets

Researched and public job sources checked: **2026-09-16**.

This is the rationale and source catalog for 16 additions to
[preferences.md](preferences.md) and [priority-companies.md](priority-companies.md).
The executable collection routes live in
[`src/scraper/registry.ts`](../src/scraper/registry.ts). All 16 have direct
collection routes; Palo Alto Networks, Vanta, and Zscaler reuse existing entries.

## Selection approach

Favor software businesses with important customer problems, evidence of adoption
or financing, technical depth, and room for substantial growth over the next
few years. Prefer engineers owning problems through delivery rather than only
executing predefined tickets. This is a hiring watchlist, not a prediction that
any company will grow at a particular rate. Financing figures below are dated
historical signals, not asserted current valuations or profitability.

CrowdStrike, Palo Alto Networks, and Zscaler are established public-company
anchors, not startups. Throne is included at the user's explicit request and as
a strong mission/culture reference; its growth evidence is less established
than the scaled companies below. Other entries span growth-stage startups and
more mature private businesses. Ownership language is employer-reported;
confirm actual autonomy, mentorship, and responsibility with the hiring team.

## Software security targets

| Company and official careers page | Why monitor it; growth evidence | Agency / ownership evidence |
| --- | --- | --- |
| [CrowdStrike](https://www.crowdstrike.com/en-us/careers/) | Explicit user target; security software at large distributed-systems scale, with an emerging-talent program. Established anchor rather than a startup growth bet. | Careers page describes autonomous teams and end-to-end engineering problem solving. |
| [Palo Alto Networks](https://jobs.paloaltonetworks.com/en/) | Explicit user target; broad security engineering organization and a dedicated early-careers program. Existing Workday source now included in the approved list. | Evaluate team-specific ownership in interviews; early-careers access verified, startup-style autonomy not established. |
| [Zscaler](https://www.zscaler.com/careers) | Established cloud/zero-trust security software anchor; already has a functioning Greenhouse source. | Team-specific agency still needs interview validation. |
| [Chainguard](https://www.chainguard.dev/careers) | Secures open-source software supply chains. [April 2025 Series D](https://www.chainguard.dev/unchained/announcing-chainguards-series-d-building-the-safe-source-for-all-open-source): $356M at a $3.5B valuation. | Careers values emphasize deliberate action, customer problems, and employee equity. |
| [Semgrep](https://semgrep.dev/about/careers/) | Developer-facing application security and agentic security workflows. [February 2025 Series D](https://semgrep.dev/blog/2025/series-d-announcement/): $100M. Particularly relevant to software engineers building developer tools. | Product/engineering fit is strong; verify scope and autonomy for the specific early-career team. |
| [Vanta](https://www.vanta.com/company/careers) | Security/compliance and trust automation; adjacent to core threat detection. [July 2025 Series D](https://www.vanta.com/resources/vanta-announces-series-d): $150M at $4.15B. | Careers principles explicitly favor action, iteration, and accountability. |
| [Abnormal AI](https://abnormal.ai/careers) | Behavioral AI for email and identity threats. [2024 business review](https://abnormal.ai/blog/transformative-year-for-abnormal-security) records a $250M Series D at $5.1B. | Careers material explicitly emphasizes ownership and broad responsibility. ATS still uses the historical `abnormalsecurity` name. |
| [Huntress](https://www.huntress.com/company/careers) | Managed security for under-resourced organizations. [July 30, 2026 announcement](https://www.huntress.com/press-release/huntress-surpasses-250-million-in-arr): over $250M ARR, 65% year-over-year growth, and 270,000 businesses protected. | Remote, mission-driven team; specific early-career ownership and mentorship remain interview questions. |

## Healthcare targets

These cover three different kinds of impact. Disease-focused AI includes Aidoc,
PathAI, and Owkin. Abridge, Ambience, and Hippocratic AI address care delivery
and workload. Throne and Oura are the closest continuous-monitoring analogues;
they are wellness products, not established disease treatments.

| Company and official careers page | Problem and growth evidence | Agency / ownership evidence |
| --- | --- | --- |
| [Throne Science](https://thronescience.com/pages/careers) | Gut, hydration, and urinary wellness tracking through sensing and software. User-selected reference; no independently established revenue/valuation milestone in this review. The company explicitly labels its product general wellness. | Careers page explicitly asks people to define and own whole problems through production, crossing software, ML, and device boundaries. |
| [Oura](https://ouraring.com/careers) | Longitudinal wearable health data, closest scaled analogue to Throne. [October 2025 company release](https://www.businesswire.com/news/home/20251014306417/en/URA-Raises-Over-%24900M-to-Accelerate-Global-Expansion-and-Health-Innovation): over $900M financing, approximately $11B valuation, and 5.5M rings sold. | Software/data product ownership should be checked per team. Evaluate technical roles against new-grad experience requirements. |
| [Aidoc](https://www.aidoc.com/about/careers/) | Imaging AI supporting detection and clinical prioritization. [April 2026 Series E](https://www.aidoc.com/about/news/aidoc-raises-150-million-series-e-led-by-goldman-sachs-to-scale-clinical-ai-for-earlier-safer-diagnoses/): $150M; company reports deployment in nearly 2,000 hospitals. | Strong clinical deployment signal; exact autonomy and early-career mentorship need verification. |
| [PathAI](https://www.pathai.com/careers) | AI pathology for diagnostics and drug development. [Company milestones](https://www.pathai.com/about-us) include FDA/EMA qualification of AIM-MASH AI Assist and 2026 breakthrough designation for PathAssist Derm. These are specific regulatory milestones, not blanket approval of all products. | Careers values explicitly include accountability and responsibility for commitments. |
| [Owkin](https://www.owkin.com/careers) | Agentic biomedical research and drug discovery. [September 11, 2026 Servier agreement](https://www.owkin.com/newsfeed/owkin-to-license-k-pro-and-multimodal-data-to-servier-to-advance-oncology-research) licenses its K Pro AI scientist and multimodal data for oncology research. | Careers emphasizes scientific curiosity and interdisciplinary work; validate individual delivery ownership. US opportunities may be limited. |
| [Abridge](https://www.abridge.com/careers) | Clinical conversation/documentation AI, addressing administrative burden rather than directly treating disease. [June 2025 Series E](https://www.abridge.com/blog/series-e): $300M and over 150 enterprise health-system partners reported. | Strong product deployment signal; assess team-specific agency and mentorship. |
| [Ambience Healthcare](https://www.ambiencehealthcare.com/careers) | Documentation, coding, and clinical workflow AI. [July 2025 Series C](https://www.ambiencehealthcare.com/blog/ambience-healthcare-announces-243-million-series-c-to-scale-its-ai-platform-for-health-systems): $243M; named deployments include Cleveland Clinic and UCSF Health. | Especially strong stated match: explicit extreme ownership, initiative, completion, and hiring for growth potential. |
| [Hippocratic AI](https://hippocraticai.com/careers/) | Patient-facing healthcare agents, including care outreach and follow-up; evaluate each product's clinical scope rather than assuming diagnostic capability. [November 2025 Series C](https://hippocraticai.com/hippocratic-ai-announces-series-c-funding-126-million/): $126M at $3.5B. | Engineering postings describe building agents through deployment; confirm junior scope and supervision. |

## Exact scheduled collection routes

These are public, unauthenticated sources. Counts are raw postings returned in
the verification run, **not eligible internships/new-grad openings**. Workday
counts reflect the existing adapter's targeted searches rather than full boards.
Counts naturally change. The production adapters were used for the final check.
All 16 sources succeeded; **zero postings passed the original strict preferences**
in that check, before broadening level-I roles and internship seasons. This adds monitoring for future openings, not 16 current job
matches. No generated board or alert ledger was refreshed.

| Company | Adapter | Public source / board | Raw postings at verification |
| --- | --- | --- | ---: |
| CrowdStrike | Workday | [CXS jobs endpoint](https://crowdstrike.wd5.myworkdayjobs.com/wday/cxs/crowdstrike/crowdstrikecareers/jobs) (POST searches) | 82 |
| Palo Alto Networks | Workday | [CXS jobs endpoint](https://paloaltonetworks.wd5.myworkdayjobs.com/wday/cxs/paloaltonetworks/panwexternalcareers/jobs) (POST searches) | 374 |
| Zscaler | Greenhouse | [zscaler](https://boards-api.greenhouse.io/v1/boards/zscaler/jobs?content=true) | 373 |
| Chainguard | Greenhouse | [chainguard](https://boards-api.greenhouse.io/v1/boards/chainguard/jobs?content=true) | 85 |
| Semgrep | Ashby | [semgrep](https://api.ashbyhq.com/posting-api/job-board/semgrep) | 10 |
| Vanta | Ashby | [vanta](https://api.ashbyhq.com/posting-api/job-board/vanta) | 95 |
| Abnormal AI | Greenhouse | [abnormalsecurity](https://boards-api.greenhouse.io/v1/boards/abnormalsecurity/jobs?content=true) | 71 |
| Huntress | Greenhouse | [huntress](https://boards-api.greenhouse.io/v1/boards/huntress/jobs?content=true) | 38 |
| Throne Science | Throne public HTML | [Careers cards and linked detail pages](https://thronescience.com/pages/careers) | 3 |
| Oura | Greenhouse | [oura](https://boards-api.greenhouse.io/v1/boards/oura/jobs?content=true) | 92 |
| Aidoc | Greenhouse | [aidocmedical](https://boards-api.greenhouse.io/v1/boards/aidocmedical/jobs?content=true) | 31 |
| PathAI | Greenhouse | [pathai](https://boards-api.greenhouse.io/v1/boards/pathai/jobs?content=true) | 9 |
| Owkin | Ashby | [owkin](https://api.ashbyhq.com/posting-api/job-board/owkin) | 2 |
| Abridge | Ashby | [Abridge](https://api.ashbyhq.com/posting-api/job-board/Abridge) | 42 |
| Ambience Healthcare | Ashby | [ambiencehealthcare](https://api.ashbyhq.com/posting-api/job-board/ambiencehealthcare) | 14 |
| Hippocratic AI | Ashby | [Hippocratic AI](https://api.ashbyhq.com/posting-api/job-board/Hippocratic%20AI) | 30 |

The existing `watch.yml` union of approved + priority + watched companies
includes these sources after the changes are committed and pushed. The 12-hour
full sweep includes them as well. No new workflow, secret, login, or browser is
needed. No workflow was dispatched as part of this change.

Throne has no ATS API linked from its current careers page. Its dedicated
adapter reads the publicly served job cards and detail pages, keeps stable
URL-based IDs, and reports an error if expected markup disappears. It does not
invent posting dates. Missing dates can prevent freshness-gated alerts even
when a future eligible role appears on the board. Currently its three roles
are experienced/senior roles and do not pass the existing early-career policy.

## Roles and internship availability for every company above

I am a **new graduate**, looking for Software Engineer I / 1 and other technical
engineering jobs: AI/ML, distributed systems, research engineering, backend,
platform, infrastructure, cloud, data, security, and related engineering work.
I am also explicitly open to **Forward Deployed Engineering (FDE)** at every
company above: customer-facing software/AI development, deployment, and
integration. Include both new-grad/entry-level/junior/level-I FDE positions and
FDE internships/co-ops in any season, subject to the same experience-level fit.
Include new-grad, early-career, entry-level, junior, and level-I opportunities;
check job descriptions for experience/degree fit. Do not treat senior or
experienced-hire roles as suitable merely because the company is a target.

I am also open to **internships and co-ops in any season**: Fall 2026, Winter
2027, Spring 2027, Summer 2027, next fall (Fall 2027), and rolling or unspecified
start dates. All 16 companies are approved for Summer 2027. Location, seniority,
and degree/enrollment fit still matter. Matching recent postings can use the
existing big-tech alert stream; no extra urgent watches are added.

## Researched follow-up candidates, not enabled as direct sources

- **[Cyera](https://www.cyera.com/careers)** — strong AI/data security fit;
  [January 2026 financing](https://www.cyera.com/press-releases/cyera-raises-400m-to-meet-rapidly-growing-demand-for-ai-security-among-enterprises)
  announced $400M. Careers links use Comeet, which this repository does not
  currently support. Verify and implement that public source before promoting
  it into the automated list.
- **[Function Health](https://www.functionhealth.com/careers)** — close match
  for longitudinal health data and medical intelligence; its investor confirmed
  a [$298M Series B in November 2025](https://a16z.com/announcement/function-health-series-b/).
  The old `function-health.breezy.hr/json` endpoint returned an empty array;
  the current official careers page links to [Gem](https://jobs.gem.com/function-health).
  Do not register the stale Breezy board as healthy coverage. A Gem adapter or
  verified current first-party source is required before automated inclusion.

For future additions, apply the same evidence threshold and verify an actual
collection route before editing the allowlist. Category prose does not cause
the Actions bot to research or discover additional companies on its own.
