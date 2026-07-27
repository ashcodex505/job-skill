# Job Discovery Preferences — Ashish Kurse

These preferences define both ranking signals and hard eligibility rules for
Job Discovery. Bullets under the recognized headings are machine-readable; the
explanatory text documents the intent behind each rule.

## Eligibility policy

Full-time software engineering results must explicitly identify themselves as
new-grad or early-career opportunities. Do not treat a generic `Software
Engineer` title as entry level merely because it lacks words such as `Senior`
or `Staff`. New-grad 2027 roles are not restricted to a single posting season —
search for them whenever they open during the 2027 cycle, at any of the
approved companies below as well as other suitable employers.

Internship discovery is limited to Fall 2026, Spring 2027, and Summer 2027.
Fall 2026 and Spring 2027 remain open across suitable employers, with extra
attention to remote or Arizona-based co-ops at the approved companies list.
Summer 2027 is intentionally selective and is restricted to the approved
company list below: established major technology companies, unicorns, elite
trading firms with strong engineering organizations, and high-signal
technology startups. This includes standard internships as well as
master's/graduate-student internship tracks at those same companies.

Location is a hard filter, not just a ranking boost: a posting must be based in
the United States, or explicitly remote or hybrid. A posting whose only stated
locations are clearly outside the US (e.g. London, Dublin, Bangalore, Toronto)
is excluded outright, even if everything else about it matches — this is
enforced in code (`src/scraper/classify.ts` → `isUsRemoteOrHybridLocation`),
not just this file. Ambiguous or unstated locations are not excluded, since
most postings are genuinely US-based even when the location field is blank or
generic ("Multiple Locations").

## Target roles

- Software Engineer
- Software Developer
- Backend Engineer
- Frontend Engineer
- Full-Stack Engineer
- Platform Engineer

## Seasons

- 2027 New Grad
- Fall 2026
- Spring 2027
- Summer 2027

## Required new grad title keywords

At least one of these phrases must appear in a full-time role title. This is a
hard filter, not merely a relevance boost.

- New Grad
- New Graduate
- Early Career
- Early Careers

## Internship seasons

An internship title must state one of these seasons. Internships with a missing,
ambiguous, or different season are excluded.

- Fall 2026
- Spring 2027
- Summer 2027

## Summer 2027 approved companies

Summer 2027 internships must match this curated allowlist. The list favors
major technology companies, unicorns, selective product companies, strong
developer-infrastructure businesses, and small high-signal technology startups.
Edit this section whenever a newly identified company meets that bar.

- Adobe
- Airbnb
- Amazon
- Anduril
- Anthropic
- Apple
- Asana
- Atlassian
- Brex
- Citadel
- Cloudflare
- Confluent
- Cursor
- Databricks
- Datadog
- Discord
- DoorDash
- Dropbox
- Duolingo
- ElevenLabs
- Figma
- Google
- Hudson River Trading
- Hugging Face
- Instacart
- Jane Street
- Jump Trading
- Linear
- LinkedIn
- Lyft
- Meta
- Microsoft
- MongoDB
- Netflix
- Notion
- NVIDIA
- OpenAI
- Palantir
- Perplexity
- Pinterest
- Plaid
- Ramp
- Reddit
- Rippling
- Robinhood
- Roblox
- Salesforce
- Samsara
- Scale AI
- Shopify
- Snowflake
- SpaceX
- Spotify
- Stripe
- Supabase
- Tesla
- TikTok
- Two Sigma
- Uber
- Vercel
- Verkada
- Waymo
- Coinbase
- Snap
- Zoox
- Applied Intuition
- Bloomberg
- Block
- Affirm
- Canva
- Airtable
- Grammarly
- Replit
- HashiCorp
- GitLab
- Okta
- ServiceNow
- Epic Games
- Character.AI
- xAI
- Mistral AI
- Wiz

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
- Payments
- Fintech

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
