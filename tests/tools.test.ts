import assert from "node:assert/strict";
import { test } from "node:test";
import { inputCount } from "../src/tools.ts";

test("inputs are counted unless the input is a union beside empty properties", () => {
  assert.equal(inputCount({ type: "object", properties: { a: {}, b: {} } }), 2);
  assert.equal(
    inputCount({ type: "object", properties: {}, anyOf: [{}, {}] }),
    undefined,
  );
  assert.equal(inputCount({ oneOf: [{}, {}] }), undefined);
  assert.equal(
    inputCount({
      type: "object",
      properties: { a: {}, b: {} },
      oneOf: [{ required: ["a"] }, { required: ["b"] }],
    }),
    2,
  );
});
