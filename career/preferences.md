# Job Discovery Preferences — Ashish Kurse

These preferences define both ranking signals and hard eligibility rules for
Job Discovery. Bullets under the recognized headings are machine-readable; the
explanatory text documents the intent behind each rule.

## Eligibility policy

I am a new-grad / early-career candidate seeking full-time software engineering
roles, including Forward Deployed Engineer (FDE), Software Engineer I / 1,
AI and machine learning, distributed
systems, infrastructure, platform, data, cloud, security, research engineering,
and other software-centered engineering work suited to a graduating student.
Firmware, embedded, hardware, FPGA, and ASIC roles are outside this search,
including titles that combine one of those specializations with “software.” Explicit
new-grad, early-career, entry-level, junior, and Engineer I / 1 titles qualify
for discovery. A level-I title is a lead to review, not proof of eligibility:
check experience and degree requirements before applying. Generic experienced
roles and senior/staff/lead/manager roles remain out of scope. Search throughout
the 2027 new-grad cycle rather than only during one recruiting season.

I am open to internships and co-ops in **any season**, including Fall 2026,
Winter 2027, Spring 2027, Summer 2027, and next fall (Fall 2027), as well as
rolling or unspecified start dates. The seasons below are ranking preferences,
not an internship date restriction. Summer 2027 remains selective at the
approved companies below; other seasons remain open across suitable employers.
Student enrollment and degree requirements must still fit my circumstances.

I am explicitly open to **Forward Deployed Engineering (FDE)**: customer-facing
technical work that builds, deploys, and integrates software or AI systems for
users. Include FDE internships/co-ops in any season and new-grad, entry-level,
junior, or level-I FDE roles. Apply the same experience-level requirements as
other engineering roles; an FDE title alone does not establish new-grad fit.

Location is a hard filter, not just a ranking boost: a posting must be based in
the United States, or explicitly remote or hybrid. A posting whose only stated
locations are clearly outside the US (e.g. London, Dublin, Bangalore, Toronto)
is excluded outright, even if everything else about it matches — this is
enforced in code (`src/scraper/classify.ts` → `isUsRemoteOrHybridLocation`),
not just this file. Ambiguous or unstated locations are not excluded, since
most postings are genuinely US-based even when the location field is blank or
generic ("Multiple Locations").

## Company focus and ownership

Prioritize high-value software security companies and startups building cloud,
application, identity, data, and software supply-chain security, including
CrowdStrike and Palo Alto Networks. Also prioritize healthcare startups using
software, machine learning, and AI agents to address meaningful clinical
problems: disease detection, diagnostics, treatment research, patient follow-up,
and clinician workload. Throne Science is a reference for continuous personal
health monitoring; wellness products should not be described as proven disease
treatments.

Baseten is a top-priority AI infrastructure company. I am especially interested
in inference engineering built around distributed systems, production serving,
reliability, latency, autoscaling, networking, observability, and developer
infrastructure. Prefer inference roles that value strong software and systems
engineering without requiring prior ML research or model-training experience.
Actively monitor Baseten for internships and co-ops in any season, including
inference, distributed-systems, infrastructure, platform, reliability, and FDE
internships, as well as eligible new-grad roles.
Do not assume I have an ML background; apply the normal new-grad and experience
requirements before treating a Baseten role as eligible.

Favor credible customer adoption, defensible technology, and potential for
substantial growth over the next few years, with high agency, end-to-end
ownership, initiative, and close contact with users. Funding and valuation are
signals, not guarantees of future growth. Evaluate actual team ownership during
interviews; company values alone are not proof of day-to-day culture.

The researched companies, official careers links, evidence, and scraper routes
are in [security-healthcare-targets.md](security-healthcare-targets.md).
These focus statements guide curation; they are not machine-enforced filters
or an instruction for GitHub Actions to discover arbitrary companies. Explicit
names in the approved list and working entries in `src/scraper/registry.ts`
enable scheduled scans. The role, internship-season, location, and seniority
rules in this file apply, so an approved company may have zero eligible roles.

## Target roles

- Software Engineer
- Software Developer
- Backend Engineer
- Frontend Engineer
- Full-Stack Engineer
- Platform Engineer
- Forward Deployed Engineer
- Forward Deployed Software Engineer
- Forward Deployed AI Engineer
- Deployment Engineer
- Inference Engineer
- AI Inference Engineer
- Inference Infrastructure Engineer
- AI Engineer
- Artificial Intelligence Engineer
- Machine Learning Engineer
- ML Engineer
- Applied AI Engineer
- Distributed Systems Engineer
- Infrastructure Engineer
- Data Engineer
- Cloud Engineer
- Security Engineer
- Site Reliability Engineer
- DevOps Engineer

## Seasons

- 2027 New Grad
- Fall 2026
- Winter 2027
- Spring 2027
- Summer 2027
- Fall 2027

## Required new grad title keywords

At least one of these phrases must appear in a full-time role title. This is a
hard filter, not merely a relevance boost. Level I / 1 and junior titles are
also accepted as early-career leads; experience requirements need review.

- New Grad
- New Graduate
- College Grad
- College Graduate
- Early Career
- Early Careers
- Entry Level
- Junior
- Engineer I
- Engineer 1
- Developer I
- Developer 1
- SWE I
- SWE 1
- SDE I
- SDE 1

## Internship seasons

`Any` accepts all internship seasons and rolling or unstated start dates.
Software/technical-role, location, seniority, and the Summer 2027 approved-company
checks still apply. The `Seasons` section above provides preferred dates only.

- Any

## Summer 2027 approved companies

Summer 2027 internships must match this curated allowlist. The list favors
major technology companies, unicorns, selective product companies, strong
developer-infrastructure businesses, and small high-signal technology startups.
Edit this section whenever a newly identified company meets that bar.

- Abnormal AI
- Abridge
- Adobe
- Affirm
- Aidoc
- Airbnb
- Airtable
- Amazon
- Ambience Healthcare
- Anduril
- Anthropic
- Apple
- Applied Intuition
- Asana
- Atlassian
- Autodesk
- Baseten
- Block (Square)
- Bloomberg
- Booking.com
- Brex
- Canva
- Cerebras
- Chainguard
- Character.AI
- Cisco
- Citadel
- Cloudflare
- Cognition
- Cohere
- Coinbase
- Confluent
- CrowdStrike
- Cursor
- Databricks
- Datadog
- Dell
- Discord
- DoorDash
- Dropbox
- Duolingo
- eBay
- ElevenLabs
- Epic Games
- Expedia
- Figma
- Gemini
- GitLab
- Google
- Grammarly
- Harvey
- HashiCorp
- Hippocratic AI
- HP
- Hudson River Trading
- Hugging Face
- Huntress
- IBM
- Instacart
- Intel
- Intuit
- Jane Street
- Jump Trading
- Linear
- LinkedIn
- Lyft
- Meta
- Microsoft
- Mistral AI
- MongoDB
- Netflix
- Notion
- NVIDIA
- Okta
- OpenAI
- Oracle
- Oura
- Owkin
- Palantir
- Palo Alto Networks
- PathAI
- PayPal
- Perplexity
- Physical Intelligence
- Pinterest
- Plaid
- Qualcomm
- Quora
- Ramp
- Reddit
- Reflection AI
- Replit
- Rippling
- Robinhood
- Roblox
- Salesforce
- Samsara
- SAP
- Scale AI
- Semgrep
- ServiceNow
- Shopify
- Sierra
- Snap
- Snowflake
- SpaceX
- Splunk
- Spotify
- SSI
- Stripe
- Supabase
- Tesla
- Throne Science
- TikTok
- Together AI
- Two Sigma
- Uber
- Vanta
- Vercel
- Verkada
- VMware
- Waymo
- Wiz
- Workday
- X (Twitter)
- xAI
- Yahoo
- Zoom
- Zoox
- Zscaler

## Max posting age (days)

Opt-in board-wide freshness gate: a posting older than this many days is
excluded from the board entirely, not just from notifications (compare the
⭐ big-tech alert's fixed 1-week cutoff, which only governs that one
notification stream). A posting with no known posted date is never
excluded by this — same rule as every other filter here: don't penalize
missing data. Leave this section empty (no bullet below) to disable it,
which is the current default and preserves existing board behavior. To
enable, add a single bullet with a number, e.g. `- 45`.

## Preferred locations

Location is a ranking preference, not a hard exclusion. Strong remote or
relocation-worthy roles may still qualify.

- Remote
- Arizona
- Tempe
- Phoenix
- Scottsdale
- Chandler

## Positive title keywords

These terms boost otherwise eligible listings; they do not override the hard
new-grad, season, or Summer 2027 company rules.

- Intern
- Internship
- Co-op
- New Grad
- New Graduate
- Early Career
- Early Careers
- Software Engineering
- Forward Deployed
- Payments
- Fintech
- AI Engineer
- Machine Learning
- Distributed Systems
- Inference
- Model Serving
- Engineer I
- Engineer 1
- Junior

## Degree eligibility and software-domain exclusions

Accept roles open to master's students/graduates, including combined
Master's / PhD, MS / PhD, and MSc / PhD opportunities. Exclude PhD-only or
doctoral-only roles. A PhD preference alone is not a PhD-only requirement.
The scraper checks titles and available descriptions; when a source supplies
no description, it can only apply degree rules to the title.

Exclude any role with **hardware**, **firmware**, **embedded**, **FPGA**, or
**ASIC** in its title, even if it accepts master's candidates or is otherwise
an internship/new-grad match. Incidental mentions in software job descriptions
do not disqualify a role.

## Negative title keywords

Exclude specializations and seniority signals that do not match the current
search. A negative keyword always wins over a positive match.

- Senior
- Staff
- Principal
- Lead
- Manager
- Mid-Level
- Experienced Hire
- Embedded
- Firmware
- FPGA
- ASIC
- Hardware
- COBOL
- Mainframe
- Salesforce Admin
- Blockchain
- Web3
- Crypto
