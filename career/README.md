# Career profile (career-ops style)

These markdown files are the app's memory about **you** — the same idea as
career-ops' `cv.md` + `portals.yml`, kept as readable files in the repo so you
can always see and edit what the system knows.

| File | What it drives |
| --- | --- |
| [`profile.md`](profile.md) | Your skills and background. The scraper fetches each posting's description and computes a **skill match** — how many of your skills appear in the job — which boosts its relevance score. |
| [`preferences.md`](preferences.md) | What to scrape *for*: target roles, seasons, new-grad/junior/level-I labels, internship-season policy, the Summer 2027 company allowlist, locations, and title keywords. |

Edit them with any editor, then hit **Scrape now** (or `npm run scrape`) —
they are re-read at the start of every run. **Settings** shows what was
parsed, so you can confirm the app understood your edits.

Format rules (kept simple on purpose): the parser reads the `- ` bullet items
under each `## Heading`. Prose outside bullets is for you, not the machine —
write as much context as you like.

Three sections are hard filters rather than score hints:

- `## Required new grad title keywords` makes full-time results opt-in: a
  technical role must contain one of these phrases, including configured junior
  and level-I labels. This prevents generic SWE
  roles with unstated or experienced-hire requirements from slipping through.
- `## Internship seasons` accepts `Any` for all seasons, including unspecified
  dates (the current preference). An explicit list restricts dates instead.
- `## Summer 2027 approved companies` is a case-insensitive company allowlist
  applied only to Summer 2027 internships. Common suffixes and variants such
  as `Stripe, Inc.` and `Meta Platforms` are supported.

Leaving one of these sections empty disables that particular hard filter.

## Security and healthcare targets

The [researched company catalog](security-healthcare-targets.md) records the
security and healthcare/AI shortlist, official careers URLs, growth and
ownership evidence, and verified scheduled sources. `preferences.md` carries
the company focus and approved names; `priority-companies.md` also includes
these names for visibility in the dashboard. The watcher already unions both
lists. The category prose is curation guidance, not an automatic company search.

Adding a new name alone does not create a scraper: add or verify its entry in
`src/scraper/registry.ts` and run `npm run scrape:coverage`. These additions
use the current new-grad/level-I, any-season internship, and location policy. `watchlist.md`
is reserved for specific urgent role watches, and `browser-companies.md` is
local-only; neither is needed for this directly scheduled shortlist.
