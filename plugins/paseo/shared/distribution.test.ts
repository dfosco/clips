import fs from "node:fs";
import { expect, it } from "vitest";

it("locks registry dependencies under checkout-local package paths", () => {
  const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(lock.version).toBe(pkg.version);
  expect(lock.packages[""].dependencies).toEqual(pkg.dependencies);
  for (const [name, entry] of Object.entries(lock.packages) as [string, any][]) {
    if (!name) continue;
    expect(name).toMatch(/^node_modules\//);
    expect(entry.link).not.toBe(true);
    expect(entry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    expect(entry.integrity).toMatch(/^sha(?:256|512)-/);
  }
});
