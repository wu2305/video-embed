import { describe, expect, it } from "vitest";
import { displayName, formatTime, parseTime } from "./format";
import { parseQuery } from "./parseQuery";
import { people } from "../mock/data";

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
