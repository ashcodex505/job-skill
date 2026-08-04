import { describe, expect, it } from "vitest";
import { parseBrowserCompanies, serializeBrowserCompanies, type BrowserCompanyEntry } from "./browser-companies";

describe("browser-companies", () => {
  it("round-trips plain entries with no search query", () => {
    const entries: BrowserCompanyEntry[] = [{ name: "Meta", careersUrl: "https://www.metacareers.com/jobs?q=intern" }];
    const parsed = parseBrowserCompanies(serializeBrowserCompanies(entries));
    expect(parsed).toEqual(entries);
  });

  it("round-trips a searchQuery for search-box-driven sites (e.g. Apple)", () => {
    const entries: BrowserCompanyEntry[] = [
      { name: "Apple", careersUrl: "https://jobs.apple.com/en-us/search", searchQuery: "software engineer intern" },
    ];
    const parsed = parseBrowserCompanies(serializeBrowserCompanies(entries));
    expect(parsed).toEqual(entries);
  });

  it("round-trips a seasonHint (own-site postings rarely state a season in the title)", () => {
    const entries: BrowserCompanyEntry[] = [
      { name: "Microsoft", careersUrl: "https://apply.careers.microsoft.com/careers?domain=microsoft.com&query=intern", seasonHint: "Fall 2026" },
    ];
    const parsed = parseBrowserCompanies(serializeBrowserCompanies(entries));
    expect(parsed).toEqual(entries);
  });

  it("round-trips both searchQuery and seasonHint together, in either declared order", () => {
    const entries: BrowserCompanyEntry[] = [
      { name: "Apple", careersUrl: "https://jobs.apple.com/en-us/search", searchQuery: "software engineer intern", seasonHint: "2027 New Grad" },
    ];
    const parsed = parseBrowserCompanies(serializeBrowserCompanies(entries));
    expect(parsed).toEqual(entries);
    // Also accepts season before search on the line itself.
    const swapped = "## Browser scan\n- Apple — https://jobs.apple.com/en-us/search — season: 2027 New Grad — search: software engineer intern\n";
    expect(parseBrowserCompanies(swapped)).toEqual(entries);
  });

  it("ignores an entry with no URL segment at all", () => {
    const md = "## Browser scan\n- Acme\n- Real Co — https://real.example/careers\n";
    expect(parseBrowserCompanies(md)).toEqual([{ name: "Real Co", careersUrl: "https://real.example/careers" }]);
  });

  it("dedupes by name, case-insensitively", () => {
    const md = "## Browser scan\n- Apple — https://jobs.apple.com/a\n- apple — https://jobs.apple.com/b\n";
    expect(parseBrowserCompanies(md)).toHaveLength(1);
  });
});
