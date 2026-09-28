import { afterEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS } from "./adapters";
import { parseThroneCareers, parseThroneDescription } from "./throne";
import type { CompanyPortal } from "./registry";

const careersHtml = (cards: string) => `
  <main>
    <section class="sect careers-positions extra">
      <div class="careers-positions__list">${cards}</div>
    </section>
  </main>`;

const card = (slug: string, title: string, location = "Hybrid — Austin, Texas") => `
  <a data-kind="job" href="/pages/careers/${slug}?utm_source=test#apply" class="featured careers-position">
    <div><h3 class="careers-position__title">${title}</h3></div>
    <p class="careers-position__place">${location}</p>
  </a>`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Throne careers parser", () => {
  it("extracts stable, canonical jobs despite attribute order and extra classes", () => {
    const jobs = parseThroneCareers(careersHtml(card("site-reliability-engineer", "Site Reliability Engineer Intern")));
    expect(jobs).toEqual([
      expect.objectContaining({
        source: "throne",
        sourceId: "/pages/careers/site-reliability-engineer",
        company: "Throne Science",
        title: "Site Reliability Engineer Intern",
        location: "Hybrid — Austin, Texas",
        url: "https://thronescience.com/pages/careers/site-reliability-engineer",
      }),
    ]);
  });

  it("fails closed on layout drift but accepts an explicit empty state", () => {
    expect(() => parseThroneCareers("<main><p>No current openings</p></main>")).toThrow(/missing positions section/);
    expect(parseThroneCareers(careersHtml("<p>No current openings</p>"))).toEqual([]);
  });

  it("extracts readable detail-page content and rejects non-job markup", () => {
    expect(parseThroneDescription("<main><h1>Role</h1><p>Build &amp; operate systems.</p></main>"))
      .toBe("Role Build & operate systems.");
    expect(() => parseThroneDescription("<main><p>Generic page</p></main>")).toThrow(/missing job detail content/);
  });
});

describe("Throne adapter", () => {
  it("keeps every listing when one detail page fails", async () => {
    const html = careersHtml([
      card("working-role", "Software Engineer Intern"),
      card("missing-role", "Site Reliability Engineer, New Grad"),
    ].join(""));
    const requested: string[] = [];
    let releaseWorkingDetail!: (response: Response) => void;
    const workingDetail = new Promise<Response>((resolve) => {
      releaseWorkingDetail = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/pages/careers")) return new Response(html, { status: 200 });
      if (url.endsWith("/working-role")) return workingDetail;
      return new Response("not found", { status: 404 });
    }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const jobsPromise = ADAPTERS.throne({
      name: "Throne Science",
      website: "https://thronescience.com",
      careersUrl: "https://thronescience.com/pages/careers",
      ats: "throne",
    } satisfies CompanyPortal);

    // The second request starts while the first is still pending: details are
    // bounded-concurrent rather than serialized.
    await vi.waitFor(() => {
      expect(requested).toContain("https://thronescience.com/pages/careers/missing-role");
    });
    releaseWorkingDetail(new Response("<main><h1>Working role</h1><p>Uses TypeScript.</p></main>", { status: 200 }));
    const jobs = await jobsPromise;

    expect(jobs).toHaveLength(2);
    expect(jobs.find((job) => job.sourceId?.endsWith("working-role"))?.description).toContain("Uses TypeScript.");
    expect(jobs.find((job) => job.sourceId?.endsWith("missing-role"))?.description).toBeNull();
    expect(requested).toEqual(expect.arrayContaining([
      "https://thronescience.com/pages/careers/working-role",
      "https://thronescience.com/pages/careers/missing-role",
    ]));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("description unavailable"));
  });
});
