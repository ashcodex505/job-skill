import { afterEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS, scrapeSimplifyFeeds } from "./adapters";
import type { CompanyPortal } from "./registry";

/** Mocked-fetch adapter tests: response shape → RawJob mapping. */

function mockFetchOnce(payloads: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const key = Object.keys(payloads).find((k) => String(url).includes(k));
      if (!key) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(payloads[key]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("smartrecruiters adapter", () => {
  const portal: CompanyPortal = {
    name: "Visa",
    website: "https://visa.com",
    careersUrl: "https://corporate.visa.com/en/jobs",
    ats: "smartrecruiters",
    slug: "visa",
  };

  it("maps postings and builds public job URLs", async () => {
    mockFetchOnce({
      "api.smartrecruiters.com/v1/companies/visa/postings": {
        totalFound: 2,
        content: [
          {
            id: "744000012345",
            name: "Software Engineer Intern",
            releasedDate: "2026-06-01T00:00:00.000Z",
            location: { city: "Austin", region: "TX", country: "us", remote: false },
            company: { identifier: "Visa" },
          },
          {
            id: "744000067890",
            name: "SWE New Grad",
            location: { remote: true },
            company: { identifier: "Visa" },
          },
        ],
      },
    });
    const jobs = await ADAPTERS.smartrecruiters(portal);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: "smartrecruiters",
      sourceId: "744000012345",
      company: "Visa",
      title: "Software Engineer Intern",
      location: "Austin, TX, us",
      url: "https://jobs.smartrecruiters.com/Visa/744000012345",
      postedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(jobs[1].location).toBe("Remote");
  });

  it("paginates until totalFound is covered", async () => {
    const page = (offset: number) => ({
      totalFound: 150,
      content: Array.from({ length: offset === 0 ? 100 : 50 }, (_, i) => ({
        id: `id-${offset + i}`,
        name: `Role ${offset + i}`,
        company: { identifier: "Visa" },
      })),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const offset = Number(new URL(String(url)).searchParams.get("offset"));
        return new Response(JSON.stringify(page(offset)), { status: 200 });
      }),
    );
    const jobs = await ADAPTERS.smartrecruiters(portal);
    expect(jobs).toHaveLength(150);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  });
});

describe("workable adapter", () => {
  const portal: CompanyPortal = {
    name: "Hugging Face",
    website: "https://huggingface.co",
    careersUrl: "https://apply.workable.com/huggingface",
    ats: "workable",
    slug: "huggingface",
  };

  it("maps widget jobs including remote flags", async () => {
    mockFetchOnce({
      "apply.workable.com/api/v1/widget/accounts/huggingface": {
        name: "Hugging Face",
        jobs: [
          {
            title: "Machine Learning Engineer Internship",
            shortcode: "ABC123",
            url: "https://apply.workable.com/huggingface/j/ABC123/",
            published_on: "2026-06-15",
            telecommuting: true,
            city: "New York",
            state: "NY",
            country: "United States",
          },
        ],
      },
    });
    const jobs = await ADAPTERS.workable(portal);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "workable",
      sourceId: "ABC123",
      title: "Machine Learning Engineer Internship",
      location: "Remote (New York, NY, United States)",
      url: "https://apply.workable.com/huggingface/j/ABC123/",
      postedAt: "2026-06-15",
    });
  });
});

describe("simplifyjobs feed", () => {
  const NOW = new Date("2026-07-05T00:00:00Z");
  const fresh = Math.floor(NOW.getTime() / 1000) - 86_400; // 1 day old
  const stale = Math.floor(NOW.getTime() / 1000) - 200 * 86_400;

  it("maps active+visible recent listings and falls back across repos/branches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        // New-Grad repo: dev 404s, main resolves — exercises branch fallback.
        if (u.includes("New-Grad-Positions/dev")) return new Response("nf", { status: 404 });
        if (u.includes("New-Grad-Positions/main")) {
          return new Response(
            JSON.stringify([
              {
                id: "uuid-1",
                company_name: "Google",
                title: "Software Engineer, New Grad",
                locations: ["Mountain View, CA"],
                url: "https://google.com/careers/j/1",
                date_posted: fresh,
                active: true,
                is_visible: true,
              },
              { id: "uuid-2", company_name: "Old Co", title: "SWE New Grad", url: "https://x.test/2", date_posted: stale, active: true, is_visible: true },
              { id: "uuid-3", company_name: "Hidden Co", title: "SWE New Grad", url: "https://x.test/3", date_posted: fresh, active: false, is_visible: true },
            ]),
            { status: 200 },
          );
        }
        return new Response("nf", { status: 404 }); // internships repos absent
      }),
    );
    const jobs = await scrapeSimplifyFeeds(NOW);
    expect(jobs).toHaveLength(1); // stale + inactive filtered out
    expect(jobs[0]).toMatchObject({
      source: "simplifyjobs",
      sourceId: "uuid-1",
      company: "Google",
      title: "Software Engineer, New Grad",
      location: "Mountain View, CA",
      url: "https://google.com/careers/j/1",
    });
    expect(jobs[0].postedAt).toBe(new Date(fresh * 1000).toISOString());
  });

  it("throws only when no feed resolves at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nf", { status: 404 })));
    await expect(scrapeSimplifyFeeds(NOW)).rejects.toThrow(/No SimplifyJobs feed resolved/);
  });
});

describe("greenhouse adapter (shape guard)", () => {
  it("maps jobs and requests descriptions via content=true", async () => {
    mockFetchOnce({
      "boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true": {
        jobs: [
          {
            id: 123,
            title: "SWE Intern",
            absolute_url: "https://stripe.com/jobs/123",
            location: { name: "SF" },
            content: "<p>Python required</p>",
          },
        ],
      },
    });
    const jobs = await ADAPTERS.greenhouse({
      name: "Stripe",
      website: "https://stripe.com",
      careersUrl: "https://stripe.com/jobs",
      ats: "greenhouse",
      slug: "stripe",
    });
    expect(jobs[0]).toMatchObject({
      sourceId: "123",
      title: "SWE Intern",
      location: "SF",
      description: "<p>Python required</p>",
    });
  });
});

describe("speedyapply markdown parsing", () => {
  const row = (company: string, title: string, age: string) =>
    `| <a href="https://www.example.com"><strong>${company}</strong></a> | ${title} | St. Louis, MO | $62/hr | <a href="https://example.com/apply/${company}"><img src="https://i.imgur.com/x.png" alt="Apply" width="70"/></a> | ${age} |`;

  it("parses table rows into RawJobs with date-only postedAt", async () => {
    const { parseSpeedyApplyMarkdown } = await import("./adapters");
    const now = new Date("2026-07-12T12:00:00.000Z");
    const md = ["| Company | Position | Location | Salary | Posting | Age |", "|---|---|---|---|---|---|", row("NVIDIA", "Performance Engineer Intern - Fall 2026", "8d"), row("Rivian", "Software Engineering Intern", "3h")].join("\n");
    const jobs = parseSpeedyApplyMarkdown(md, now);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: "speedyapply",
      company: "NVIDIA",
      title: "Performance Engineer Intern - Fall 2026",
      location: "St. Louis, MO",
      url: "https://example.com/apply/NVIDIA",
      postedAt: "2026-07-04", // 8 days before now, date precision only
    });
    expect(jobs[1].postedAt).toBe("2026-07-12");
    // Date-only means the alert renderer will label it "time unavailable"
    // instead of inventing a clock time.
    expect(jobs[0].postedAt).not.toContain("T");
  });

  it("ignores non-row lines and malformed rows", async () => {
    const { parseSpeedyApplyMarkdown } = await import("./adapters");
    const md = ["# Heading", "| Company | Position |", "|---|---|", "| plain | row |", "", "not a table"].join("\n");
    expect(parseSpeedyApplyMarkdown(md)).toHaveLength(0);
  });
});

describe("speedyapply new-grad table shape (no salary column)", () => {
  it("parses 5-column rows too", async () => {
    const { parseSpeedyApplyMarkdown } = await import("./adapters");
    const md =
      '| <a href="https://www.northslopetech.com/"><strong>Northslope</strong></a> | Forward Deployed Software Engineer - New Grad | New York City, NY | <a href="https://jobs.ashbyhq.com/northslope/80b82167"><img src="https://i.imgur.com/x.png" alt="Apply" width="70"/></a> | 12d |';
    const jobs = parseSpeedyApplyMarkdown(md, new Date("2026-07-12T12:00:00.000Z"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      company: "Northslope",
      title: "Forward Deployed Software Engineer - New Grad",
      url: "https://jobs.ashbyhq.com/northslope/80b82167",
      postedAt: "2026-06-30",
    });
  });
});

describe("amazon adapter", () => {
  it("maps amazon.jobs search.json responses, dedupes across queries, and parses posted_date", async () => {
    mockFetchOnce({
      "amazon.jobs/en/search.json": {
        hits: 1,
        jobs: [
          {
            id: "uuid-1",
            id_icims: 10418355,
            title: "2027 Software Dev Engineer Intern",
            normalized_location: "Dublin, IRL",
            country_code: "IRL",
            job_path: "/en/jobs/10418355/2027-software-dev-engineer-intern",
            posted_date: "May 13, 2026",
            description_short: "Do you want to solve business challenges through innovative technology?",
          },
        ],
      },
    });
    const jobs = await ADAPTERS.amazon({} as CompanyPortal);
    // Same id returned by every one of the 4 query terms — deduped to one.
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "amazon",
      sourceId: "10418355",
      company: "Amazon",
      title: "2027 Software Dev Engineer Intern",
      location: "Dublin, IRL",
      url: "https://www.amazon.jobs/en/jobs/10418355/2027-software-dev-engineer-intern",
      postedAt: "2026-05-13",
    });
  });

  it("falls back to the uuid id when id_icims is missing, and null postedAt on unparseable dates", async () => {
    mockFetchOnce({
      "amazon.jobs/en/search.json": {
        hits: 1,
        jobs: [{ id: "uuid-only", title: "Software Engineer Intern", job_path: "/en/jobs/uuid-only/x", posted_date: "not a date" }],
      },
    });
    const jobs = await ADAPTERS.amazon({} as CompanyPortal);
    expect(jobs[0].sourceId).toBe("uuid-only");
    expect(jobs[0].postedAt).toBeNull();
  });
});

describe("eightfold adapter", () => {
  const portal: CompanyPortal = {
    name: "Netflix",
    website: "https://netflix.com",
    careersUrl: "https://explore.jobs.netflix.net/careers",
    ats: "eightfold",
    eightfold: { host: "explore.jobs.netflix.net", domain: "netflix.com" },
  };

  it("maps positions, dedupes across queries/pages, converts epoch-seconds postedAt", async () => {
    mockFetchOnce({
      "explore.jobs.netflix.net/api/apply/v2/jobs": {
        count: 1,
        positions: [
          {
            id: 790313241540,
            name: "Software Engineer PhD Intern, Streaming Algorithms (Summer 2026)",
            location: "Los Gatos,California,United States of America",
            t_create: 1765324800,
            canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790313241540",
          },
        ],
      },
    });
    const jobs = await ADAPTERS.eightfold(portal);
    // Same single position returned on every page of every query — one row.
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "eightfold",
      sourceId: "790313241540",
      company: "Netflix",
      title: "Software Engineer PhD Intern, Streaming Algorithms (Summer 2026)",
      location: "Los Gatos,California,United States of America",
      url: "https://explore.jobs.netflix.net/careers/job/790313241540",
      postedAt: new Date(1765324800 * 1000).toISOString(),
    });
  });

  it("throws a clear error when eightfold config is missing", async () => {
    await expect(ADAPTERS.eightfold({ ...portal, eightfold: undefined })).rejects.toThrow(/eightfold config/i);
  });

  it("stops paginating a query once a short page is returned", async () => {
    mockFetchOnce({
      "explore.jobs.netflix.net/api/apply/v2/jobs": { count: 0, positions: [] },
    });
    const jobs = await ADAPTERS.eightfold(portal);
    expect(jobs).toHaveLength(0);
  });
});
