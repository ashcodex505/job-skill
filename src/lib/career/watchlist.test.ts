import { describe, expect, it } from "vitest";
import { matchWatches, matchesWatch, parseWatchlist, serializeWatchlist, watchEquals, type Watch } from "./watchlist";

const watches: Watch[] = [
  { company: "Google", keywords: "new grad software engineer" },
  { company: "Any", keywords: "summer 2027 intern" },
];

describe("watchlist parse/serialize", () => {
  it("round-trips through markdown", () => {
    const md = serializeWatchlist(watches);
    expect(md).toContain("APP-MANAGED FILE");
    expect(parseWatchlist(md)).toEqual(watches);
  });

  it("round-trips an empty list", () => {
    expect(parseWatchlist(serializeWatchlist([]))).toEqual([]);
  });

  it("treats bullets without a separator as Any-company keywords", () => {
    expect(parseWatchlist("## Watches\n- payments intern\n")).toEqual([{ company: "Any", keywords: "payments intern" }]);
  });

  it("keeps em-dashes inside keywords intact", () => {
    const w = [{ company: "Stripe", keywords: "intern — payments" }];
    expect(parseWatchlist(serializeWatchlist(w))).toEqual(w);
  });
});

describe("matchesWatch / matchWatches", () => {
  it("requires company equality (case-insensitive) unless Any", () => {
    expect(matchesWatch(watches[0], { company: "google", title: "Software Engineer, New Grad" })).toBe(true);
    expect(matchesWatch(watches[0], { company: "Amazon", title: "Software Engineer, New Grad" })).toBe(false);
    expect(matchesWatch(watches[1], { company: "Amazon", title: "SDE Intern (Summer 2027)" })).toBe(true);
  });

  it("requires ALL keywords in the title", () => {
    expect(matchesWatch(watches[0], { company: "Google", title: "New Grad Software Engineer 2027" })).toBe(true);
    expect(matchesWatch(watches[0], { company: "Google", title: "Software Engineer III" })).toBe(false);
  });

  it("matchWatches unions watches without duplicating jobs", () => {
    const jobs = [
      { company: "Google", title: "Software Engineer, New Grad (Summer 2027 Intern conversion)" },
      { company: "Netflix", title: "Senior Engineer" },
    ];
    expect(matchWatches(watches, jobs)).toHaveLength(1);
    expect(matchWatches([], jobs)).toHaveLength(0);
  });
});

describe("watchEquals", () => {
  it("compares case/whitespace-insensitively", () => {
    expect(watchEquals({ company: "Google ", keywords: "NEW GRAD" }, { company: "google", keywords: "new grad" })).toBe(true);
    expect(watchEquals(watches[0], watches[1])).toBe(false);
  });
});
