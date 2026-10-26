import { describe, expect, it } from "vitest";
import { displayName, formatTime, parseTime } from "./format";
import { parseQuery } from "./parseQuery";
import { queryReports, searchBiMock, searchGateway } from "../pages/search";
import { resultKey } from "../types";
import { archiveRecords, documentHits, hits, metricRecords, metricReports, people } from "../mock/data";

describe("formatTime / parseTime", () => {
  it("formats seconds as mm:ss and clamps negatives", () => {
    expect(formatTime(72)).toBe("01:12");
    expect(formatTime(-3)).toBe("00:00");
  });
  it("parses mm:ss, plain seconds and rejects text", () => {
    expect(parseTime("01:12")).toBe(72);
    expect(parseTime("90.5")).toBe(90.5);
    expect(parseTime("soon")).toBeNull();
  });
  it("falls back to the cluster id when a person has no name", () => {
    expect(displayName("person-0003", people)).toBe("Ana Ruiz");
    expect(displayName("person-0011", people)).toBe("person-0011");
  });
});

describe("parseQuery", () => {
  it("leaves a query without a known name as plain text", () => {
    expect(parseQuery("a man in a suit", people)).toMatchObject({ person_ids: [], what: "a man in a suit" });
    expect(parseQuery("a man is cooking", people).unresolved).toEqual([]);
  });
  it("resolves a first name and splits off the what", () => {
    expect(parseQuery("Ana is cooking", people)).toMatchObject({ who: ["Ana Ruiz"], person_ids: ["person-0003"], what: "cooking" });
  });
  it("requires every person in an 'and' query", () => {
    expect(parseQuery("Ana and Ben are cooking", people).person_ids).toEqual(["person-0003", "person-0007"]);
  });
  it("flags a capitalised name nobody owns", () => {
    expect(parseQuery("Zed Marlow is cooking", people).unresolved).toEqual(["Zed Marlow"]);
  });
});

describe("BI metric search", () => {
  it("matches metric names, not the people the query names", () => {
    expect(searchBiMock(metricRecords, people, { query: "revenue" }).map((m) => m.metric_id)).toEqual(["hotel.revpar", "taxi.revenue_per_trip"]);
    expect(searchBiMock(metricRecords, people, { query: "Ana is presenting the budget" }).map((m) => m.metric_id)).toEqual(["fin.opex_budget_variance"]);
    expect(searchBiMock(metricRecords, people, { query: "skydiving" })).toEqual([]);
    // Used in no report: left out.
    expect(searchBiMock(metricRecords, people, { query: "EBITDA" })).toEqual([]);
  });
  it("reports a BI outage and keeps the other sources", () => {
    const { results, sources } = searchGateway(hits, archiveRecords, people, { query: "cooking" }, { bi: true }, metricRecords);
    expect(sources.find((s) => s.source === "bi")).toEqual({ source: "bi", state: "unavailable", count: 0 });
    expect(results.some((r) => r.source === "bi")).toBe(false);
    expect(results.some((r) => r.source === "archive")).toBe(true);
  });
  it("asks only the sources the search type names", () => {
    const nas = searchGateway(documentHits, archiveRecords, people, { query: "budget", type: "nas" }, {}, metricRecords);
    expect(nas.sources.map((s) => s.source)).toEqual(["nas"]);
    expect(nas.results.length).toBeGreaterThan(0);
    expect(nas.results.every((r) => !r.source)).toBe(true);
    const bi = searchGateway(hits, archiveRecords, people, { query: "budget", type: "bi" }, { archive: true }, metricRecords);
    expect(bi.sources).toEqual([{ source: "bi", state: "ok", count: 1 }]);
    expect(bi.results.every((r) => r.source === "bi")).toBe(true);
  });
});

describe("paging", () => {
  it("appends gateway pages without reordering the earlier ones", () => {
    const f = { query: "budget" };
    const whole = searchGateway(documentHits, archiveRecords, people, { ...f, limit: 50 }, {}, metricRecords);
    expect(whole.next_cursor).toBeNull();
    const pages = [];
    let cursor: string | null = null;
    do {
      const page = searchGateway(documentHits, archiveRecords, people, { ...f, limit: 2, cursor }, {}, metricRecords);
      pages.push(...page.results);
      cursor = page.next_cursor;
    } while (cursor);
    expect(pages.map(resultKey)).toEqual(whole.results.map(resultKey));
  });
  it("pages and filters a metric's reports on the server side", () => {
    const all = metricReports["hotel.revpar"]!;
    expect(queryReports(all, { limit: 5 })).toEqual({ reports: all.slice(0, 5), total: 7 });
    expect(queryReports(all, { offset: 5, limit: 5 }).reports).toEqual(all.slice(5));
    expect(queryReports(all, { q: "raj" }).total).toBe(3);
  });
});
