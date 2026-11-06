import assert from "node:assert/strict";
import { test } from "node:test";
import { linesText, schemaLines } from "../src/schema-text.ts";

const render = (schema: unknown) => linesText(schemaLines(schema));

test("properties show their type, whether they're required, constraints and description", () => {
  assert.equal(
    render({
      type: "object",
      properties: {
        url: { type: "string", format: "uri", description: "Where to fetch" },
        format: {
          type: "string",
          enum: ["text", "markdown"],
          default: "markdown",
        },
        timeout: { type: "number", exclusiveMinimum: 0, maximum: 120 },
        offset: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
      required: ["url"],
    }),
    [
      "url  string, required, format uri",
      "  Where to fetch",
      'format  "text" | "markdown", default "markdown"',
      "timeout  number, > 0, ≤ 120",
      "offset  integer, ≥ 0",
    ].join("\n"),
  );
});

test("objects inside arrays are listed under their property", () => {
  assert.equal(
    render({
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The updated todo list",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["content"],
          },
        },
      },
      required: ["todos"],
    }),
    [
      "todos  array of objects, required",
      "  The updated todo list",
      "  content  string, required",
      "  tags  array of strings",
    ].join("\n"),
  );
});

test("unions, nullable types and maps read as their alternatives", () => {
  assert.equal(
    render({
      type: "object",
      properties: {
        path: { anyOf: [{ type: "string" }, { type: "null" }] },
        mode: { type: ["string", "null"] },
        env: { type: "object", additionalProperties: { type: "string" } },
        kind: { const: "file" },
        value: {},
      },
    }),
    [
      "path  string | null",
      "mode  string | null",
      "env  object with string values",
      'kind  "file"',
      "value  any",
    ].join("\n"),
  );
});

test("local references are followed and recursive ones are named instead of expanded", () => {
  assert.equal(
    render({
      type: "object",
      $defs: {
        Node: {
          type: "object",
          description: "A tree node",
          properties: {
            name: { type: "string" },
            children: { type: "array", items: { $ref: "#/$defs/Node" } },
          },
        },
      },
      properties: { root: { $ref: "#/$defs/Node" } },
      required: ["root"],
    }),
    [
      "root  object, required",
      "  A tree node",
      "  name  string",
      "  children  array of Nodes",
    ].join("\n"),
  );
});

test("schemas without properties say so instead of rendering nothing", () => {
  assert.equal(render({ type: "object", properties: {} }), "Takes no input.");
  assert.equal(render({ type: "object" }), "Takes no input.");
  assert.equal(render({ type: "string" }), "Input is string");
  assert.equal(render(undefined), "OpenCode did not report an input schema.");
});

test("names and types are toned separately for the viewer", () => {
  assert.deepEqual(
    schemaLines({ type: "object", properties: { id: { type: "string" } } }),
    [
      [
        { text: "", tone: "plain" },
        { text: "id", tone: "name" },
        { text: "  string", tone: "muted" },
      ],
    ],
  );
});

test("a root union lists each input shape instead of claiming no input", () => {
  assert.equal(
    render({
      anyOf: [
        {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        { type: "object", properties: { url: { type: "string" } } },
        { type: "string" },
      ],
    }),
    [
      "Takes one of these inputs:",
      "Option 1",
      "  path  string, required",
      "Option 2",
      "  url  string",
      "Option 3  string",
    ].join("\n"),
  );
});

test("allOf members are merged into one property list", () => {
  assert.equal(
    render({
      $defs: { Paging: { properties: { limit: { type: "integer" } } } },
      allOf: [
        {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        { $ref: "#/$defs/Paging" },
      ],
    }),
    ["query  string, required", "limit  integer"].join("\n"),
  );
});

test("a combinator root that can't be listed falls back to the raw schema", () => {
  const schema = { type: "object", oneOf: [{ required: ["a"] }] };
  assert.equal(
    render(schema),
    [
      "OpenCode reported this input schema:",
      JSON.stringify(schema, undefined, 2),
    ].join("\n"),
  );
});

test("malformed or odd schema parts render instead of throwing", () => {
  assert.equal(
    render({
      type: "object",
      properties: {
        broken: { $ref: "#/$defs/%E0%A4%A" },
        nothing: false,
        untyped: { type: [] },
        code: { type: "string", pattern: "^\\d+\nb$" },
      },
    }),
    [
      "broken  any",
      "nothing  never",
      "untyped  any",
      'code  string, pattern "^\\d+\\nb$"',
    ].join("\n"),
  );
});

test("very long schemas are cut short with a count", () => {
  const properties = Object.fromEntries(
    Array.from({ length: 450 }, (_, index) => [
      `field${index}`,
      { type: "string" },
    ]),
  );
  const lines = schemaLines({ type: "object", properties });
  assert.equal(lines.length, 401);
  assert.equal(linesText(lines.slice(-1)), "… 50 more lines not shown.");
});

test("self-referencing allOf members render instead of overflowing the stack", () => {
  assert.match(
    render({ allOf: [{ $ref: "#" }] }),
    /^OpenCode reported this input schema:/,
  );
  assert.equal(
    render({
      type: "object",
      properties: { a: { $ref: "#/$defs/B" } },
      $defs: { B: { allOf: [{ $ref: "#/$defs/B" }] } },
    }),
    "a  any",
  );
});

test("a property that is a union of objects lists each option's fields", () => {
  assert.equal(
    render({
      type: "object",
      properties: {
        target: {
          oneOf: [
            {
              type: "object",
              properties: { kind: { const: "file" }, path: { type: "string" } },
            },
            { type: "object", properties: { kind: { const: "url" } } },
          ],
        },
      },
    }),
    [
      "target  object",
      "  Option 1",
      '    kind  "file"',
      "    path  string",
      "  Option 2",
      '    kind  "url"',
    ].join("\n"),
  );
});

test("a root object with empty properties beside a union lists each option's fields", () => {
  const variant = (kind: string, field: string) => ({
    type: "object",
    properties: {
      kind: { type: "string", const: kind },
      [field]: { type: "string" },
    },
    required: ["kind", field],
    additionalProperties: false,
  });
  for (const key of ["anyOf", "oneOf"]) {
    assert.equal(
      render({
        type: "object",
        properties: {},
        [key]: [variant("file", "path"), variant("url", "url")],
      }),
      [
        "Takes one of these inputs:",
        "Option 1",
        '  kind  "file", required',
        "  path  string, required",
        "Option 2",
        '  kind  "url", required',
        "  url  string, required",
      ].join("\n"),
    );
  }
});

test("unions inside array items list each option's fields under the array", () => {
  assert.equal(
    render({
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "Edits to apply",
          items: {
            anyOf: [
              {
                type: "object",
                properties: { oldString: { type: "string" } },
                required: ["oldString"],
              },
              { $ref: "#/$defs/Insert" },
            ],
          },
        },
        groups: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {},
              oneOf: [
                { type: "object", properties: { a: { type: "number" } } },
                { type: "object", properties: { b: { type: "number" } } },
              ],
            },
          },
        },
      },
      $defs: {
        Insert: { type: "object", properties: { line: { type: "integer" } } },
      },
    }),
    [
      "edits  array of objects",
      "  Edits to apply",
      "  Option 1",
      "    oldString  string, required",
      "  Option 2",
      "    line  integer",
      "groups  array of items of array of objects",
      "  Option 1",
      "    a  number",
      "  Option 2",
      "    b  number",
    ].join("\n"),
  );
});

test("properties shared by every option are listed before the options", () => {
  assert.equal(
    render({
      type: "object",
      properties: { mode: { type: "string" } },
      required: ["mode"],
      oneOf: [
        { type: "object", properties: { path: { type: "string" } } },
        { type: "object", properties: { url: { type: "string" } } },
        { required: ["mode"] },
      ],
    }),
    [
      "mode  string, required",
      "And one of:",
      "Option 1",
      "  path  string",
      "Option 2",
      "  url  string",
      "Option 3  any",
    ].join("\n"),
  );
});

test("nullable unions list each option's fields, directly and inside array items", () => {
  const union = {
    anyOf: [
      { type: "object", properties: { path: { type: "string" } } },
      { type: "object", properties: { url: { type: "string" } } },
    ],
  };
  assert.equal(
    render({
      type: "object",
      properties: {
        target: { anyOf: [union, { type: "null" }] },
        targets: {
          anyOf: [{ type: "array", items: union }, { type: "null" }],
        },
      },
    }),
    [
      "target  object | null",
      "  Option 1",
      "    path  string",
      "  Option 2",
      "    url  string",
      "targets  array of objects | null",
      "  Option 1",
      "    path  string",
      "  Option 2",
      "    url  string",
    ].join("\n"),
  );
});
