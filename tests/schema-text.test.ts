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

test("very long schemas are cut short with a note", () => {
  const properties = Object.fromEntries(
    Array.from({ length: 450 }, (_, index) => [
      `field${index}`,
      { type: "string" },
    ]),
  );
  const lines = schemaLines({ type: "object", properties });
  assert.equal(lines.length, 401);
  assert.equal(
    linesText(lines.slice(-1)),
    "… Schema too large to show in full.",
  );
});

test("a shared definition's fields are listed once, and later uses say where", () => {
  assert.equal(
    render({
      type: "object",
      properties: {
        home: { $ref: "#/$defs/Address" },
        work: { $ref: "#/$defs/Address", description: "Office address" },
        stops: {
          type: "array",
          items: {
            oneOf: [
              { $ref: "#/$defs/Address" },
              { type: "object", properties: { lat: { type: "number" } } },
            ],
          },
        },
        billing: {
          $ref: "#/$defs/Address",
          properties: { vat: { type: "string" } },
        },
      },
      $defs: {
        Address: {
          type: "object",
          properties: { street: { type: "string" }, city: { type: "string" } },
          required: ["street"],
        },
      },
    }),
    [
      "home  object",
      "  street  string, required",
      "  city  string",
      "work  object",
      "  Office address",
      "  Same fields as home.",
      "stops  array of objects",
      "  Option 1",
      "    Same fields as home.",
      "  Option 2",
      "    lat  number",
      "billing  object",
      "  vat  string",
    ].join("\n"),
  );
});

/** Definitions D0 to D(levels - 1), each with `breadth` fields that all refer to the next. */
function fannedOutDefinitions(breadth: number, levels: number) {
  return Object.fromEntries(
    Array.from({ length: levels }, (_, level) => [
      `D${level}`,
      {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: breadth }, (_, field) => [
            `f${field}`,
            level === levels - 1
              ? { type: "string" }
              : { $ref: `#/definitions/D${level + 1}` },
          ]),
        ),
      },
    ]),
  );
}

test("references that fan out list each level once instead of every path", () => {
  const lines = schemaLines({
    type: "object",
    properties: { query: { $ref: "#/definitions/D0" } },
    definitions: fannedOutDefinitions(8, 10),
  });
  const text = linesText(lines);
  assert.ok(lines.length < 200, `${lines.length} lines`);
  assert.match(text, /^ {4}f1 {2}object\n {6}Same fields as query\.f0\.f0\.$/m);
  assert.doesNotMatch(text, /Schema too large/);
});

test("a shared definition first listed past the depth limit is listed in full where there's room", () => {
  let nested: Record<string, unknown> = {
    type: "object",
    properties: { addr: { $ref: "#/$defs/Address" } },
  };
  for (const name of ["g", "f", "e", "d", "c", "b"]) {
    nested = { type: "object", properties: { [name]: nested } };
  }
  const text = render({
    type: "object",
    properties: { a: nested, billing: { $ref: "#/$defs/Address" } },
    $defs: {
      Address: {
        type: "object",
        properties: {
          street: { type: "string" },
          geo: { type: "object", properties: { lat: { type: "number" } } },
        },
      },
    },
  });
  assert.match(
    text,
    /^billing {2}object\n {2}street {2}string\n {2}geo {2}object\n {4}lat {2}number$/m,
  );
});

test("long enums, tuples, unions and text are shortened to fit a line", () => {
  const values = Array.from({ length: 2000 }, (_, index) => `value-${index}`);
  const properties = Object.fromEntries(
    Array.from({ length: 400 }, (_, index) => [
      `p${index}`,
      { $ref: "#/definitions/Values" },
    ]),
  );
  const schema = {
    type: "object",
    properties: {
      tuple: {
        type: "array",
        items: Array.from({ length: 1000 }, () => ({ type: "string" })),
      },
      union: {
        anyOf: Array.from({ length: 30 }, (_, index) => ({ const: index })),
      },
      described: { type: "string", description: "x".repeat(100_000) },
      ...properties,
    },
    definitions: { Values: { enum: values } },
  };
  const started = performance.now();
  const lines = linesText(schemaLines(schema)).split("\n");
  assert.ok(performance.now() - started < 2_000);
  assert.equal(
    lines[0],
    "tuple  tuple of string, string, string, string, string, string, string, string, string, string, … 990 more",
  );
  assert.equal(
    lines[1],
    "union  0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | … 20 more",
  );
  assert.match(lines.at(-2) ?? "", /^p\d+ {2}"value-0" \| .* \| … \d+ more$/);
  assert.ok(lines.every((line) => line.length <= 400));
});

test("long chains of array items and allOf members are followed only so far", () => {
  const length = 5_000;
  const chain = (link: (next: string) => Record<string, unknown>) => ({
    type: "object",
    properties: { x: { $ref: "#/definitions/D0" } },
    definitions: {
      ...Object.fromEntries(
        Array.from({ length }, (_, index) => [
          `D${index}`,
          link(`#/definitions/D${index + 1}`),
        ]),
      ),
      [`D${length}`]: {
        type: "object",
        properties: { leaf: { type: "string" } },
      },
    },
  });
  const started = performance.now();
  const items = render(
    chain((next) => ({ type: "array", items: { $ref: next } })),
  );
  const allOf = render(
    chain((next) => ({ allOf: [{ $ref: next }], properties: {} })),
  );
  assert.ok(performance.now() - started < 2_000);
  assert.match(items, /^x {2}array of items of array of .*…$/);
  assert.match(allOf, /^x {2}object$/m);
});

test("long type lists are named once each and stay listable", () => {
  let schema: Record<string, unknown> = { type: "string" };
  for (let level = 0; level < 3; level++) {
    schema = {
      type: [...Array<string>(2999).fill("array"), "null"],
      items: schema,
    };
  }
  assert.equal(
    render({
      type: "object",
      properties: { a: schema, b: { type: ["string", "null", "string"] } },
    }),
    [
      "a  array of items of array of items of array of strings | null | null | null",
      "b  string | null",
    ].join("\n"),
  );
});

test("a huge const or default shared by many fields is shortened without stalling", () => {
  const huge = "x".repeat(10_000_000);
  const properties = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      `p${index}`,
      { $ref: "#/definitions/Huge" },
    ]),
  );
  const started = performance.now();
  const lines = schemaLines({
    type: "object",
    properties,
    definitions: { Huge: { const: huge, default: { text: huge } } },
  });
  assert.ok(performance.now() - started < 2_000);
  assert.equal(lines.length, 100);
  assert.match(
    linesText(lines.slice(0, 1)),
    /^p0 {2}"x+"…, default \{"text":"x+…$/,
  );
});

test("allOf members nested too deeply to follow are marked as left out", () => {
  const length = 5_000;
  const definitions: Record<string, unknown> = {
    [`D${length}`]: {
      type: "object",
      properties: { leaf: { type: "string" } },
    },
  };
  for (let index = 0; index < length; index++) {
    definitions[`D${index}`] = {
      allOf: [{ $ref: `#/definitions/D${index + 1}` }],
      properties: { [`p${index}`]: { type: "string" } },
    };
  }
  const lines = render({
    type: "object",
    properties: { x: { $ref: "#/definitions/D0" } },
    definitions,
  }).split("\n");
  assert.equal(lines[0], "x  object");
  assert.equal(lines.at(-2), "  p0  string");
  assert.equal(lines.at(-1), "  …");
});

test("unions whose references fan out are cut short instead of stalling", () => {
  const levels = 9;
  const definitions = Object.fromEntries(
    Array.from({ length: levels }, (_, level) => [
      `U${level}`,
      level === levels - 1
        ? { type: "object", properties: { leaf: { type: "string" } } }
        : {
            anyOf: Array.from({ length: 6 }, () => ({
              $ref: `#/definitions/U${level + 1}`,
            })),
          },
    ]),
  );
  const schema = {
    type: "object",
    properties: { value: { $ref: "#/definitions/U0" } },
    definitions,
  };
  const started = performance.now();
  const lines = schemaLines(schema);
  assert.ok(performance.now() - started < 2_000);
  assert.equal(
    linesText(lines.slice(0, 1)),
    "OpenCode reported this input schema:",
  );
  assert.ok(lines.length <= 401);
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
