# Career profile (career-ops style)

These markdown files are the app's memory about **you** — the same idea as
career-ops' `cv.md` + `portals.yml`, kept as readable files in the repo so you
can always see and edit what the system knows.

| File | What it drives |
| --- | --- |
| [`profile.md`](profile.md) | Your skills and background. The scraper fetches each posting's description and computes a **skill match** — how many of your skills appear in the job — which boosts its relevance score. |
| [`preferences.md`](preferences.md) | What to scrape *for*: target roles, seasons, strict new-grad labels, allowed internship seasons, the Summer 2027 company allowlist, locations, and title keywords. |

Edit them with any editor, then hit **Scrape now** (or `npm run scrape`) —
they are re-read at the start of every run. **Settings** shows what was
parsed, so you can confirm the app understood your edits.

Format rules (kept simple on purpose): the parser reads the `- ` bullet items
under each `## Heading`. Prose outside bullets is for you, not the machine —
write as much context as you like.

Three sections are hard filters rather than score hints:

- `## Required new grad title keywords` makes full-time results opt-in: a
  software role must contain one of these phrases. This prevents generic SWE
  roles with unstated or experienced-hire requirements from slipping through.
- `## Internship seasons` excludes internships whose title does not state one
  of the listed seasons.
- `## Summer 2027 approved companies` is a case-insensitive company allowlist
  applied only to Summer 2027 internships. Common suffixes and variants such
  as `Stripe, Inc.` and `Meta Platforms` are supported.

Leaving one of these sections empty disables that particular hard filter.
