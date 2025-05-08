import assert from "node:assert/strict";
import test from "node:test";

test.describe("constants", { concurrency: true }, async () => {
  let exports = await import("./constants.js");

  await test("PACKAGE_JSON", async (t) => {
    await t.test("is an object", async () => {
      assert.equal(typeof exports.PACKAGE_JSON, "object");
    });
  });
});
