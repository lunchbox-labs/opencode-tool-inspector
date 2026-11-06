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
