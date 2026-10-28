import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps production-bundled components out of the early registry and starts once after HA is ready", () => {
  const result = execFileSync(process.execPath, ["--experimental-vm-modules", "tests/helpers/check-bootstrap-bundle.mjs"], { encoding: "utf8", timeout: 10_000 });
  expect(result.trim()).toBe("Deferred production bundle: passed");
});
