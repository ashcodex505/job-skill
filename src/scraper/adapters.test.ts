import { afterEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS } from "./adapters";
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
