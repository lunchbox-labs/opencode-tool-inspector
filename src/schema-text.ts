export type TextTone = "plain" | "name" | "muted";

export interface TextSegment {
  text: string;
  tone: TextTone;
}

/** A line of rendered text, split into toned segments so the viewer can colour names and types. */
export type TextLine = TextSegment[];

type JsonObject = Record<string, unknown>;

const indentWidth = 2;
const maximumDepth = 8;
const maximumLines = 400;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function literal(value: unknown): string {
  const json = JSON.stringify(value) as string | undefined;
  return json ?? String(value);
}

function plain(text: string): TextSegment {
  return { text, tone: "plain" };
}

function indentText(depth: number): string {
  return " ".repeat(depth * indentWidth);
}

function descriptionLines(description: unknown, depth: number): TextLine[] {
  if (typeof description !== "string" || description.trim() === "") {
    return [];
  }
  return description
    .trim()
    .split(/\r?\n/)
    .map((line) => [plain(`${indentText(depth)}${line}`)]);
}

function withoutReference(node: JsonObject): JsonObject {
  const { $ref: _reference, ...rest } = node;
  return rest;
}

function decodedPointerKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey);
  } catch {
    return rawKey;
  }
}

/** Resolves local `$ref`s, as zod and MCP servers emit for shared definitions. */
function resolveReference(
  node: JsonObject,
  root: JsonObject,
  visiting: ReadonlySet<string>,
): { node: JsonObject; reference?: string; recursive: boolean } {
  const reference = node.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#")) {
    return { node, recursive: false };
  }
  if (visiting.has(reference)) {
    return { node, reference, recursive: true };
  }
  let target: unknown = root;
  for (const rawKey of reference.slice(1).split("/").filter(Boolean)) {
    const key = decodedPointerKey(rawKey)
      .replaceAll("~1", "/")
      .replaceAll("~0", "~");
    target = isObject(target) ? target[key] : undefined;
  }
  return isObject(target)
    ? {
        node: { ...target, ...withoutReference(node) },
        reference,
        recursive: false,
      }
    : { node, reference, recursive: false };
}

function referenceName(reference: string): string {
  const name = reference.split("/").at(-1) ?? "";
  return name === "" || name === "#" ? "the whole input" : name;
}

function nonEmptyList(value: unknown): unknown[] | undefined {
  if (Array.isArray(value) && value.length > 0) {
    const items: unknown[] = value;
    return items;
  }
  return undefined;
}

function variants(node: JsonObject): unknown[] | undefined {
  return nonEmptyList(node.anyOf) ?? nonEmptyList(node.oneOf);
}

function hasCombinators(node: JsonObject): boolean {
  return variants(node) !== undefined || nonEmptyList(node.allOf) !== undefined;
}

/** Folds `allOf` members' properties and required names into one object schema. */
function mergedAllOf(
  node: JsonObject,
  root: JsonObject,
  visiting: ReadonlySet<string>,
): JsonObject {
  const members = nonEmptyList(node.allOf);
  if (members === undefined) {
    return node;
  }
  const properties: JsonObject = {};
  const required = new Set<unknown>();
  for (const member of [...members, node]) {
    if (!isObject(member)) {
      continue;
    }
    const resolved = resolveReference(member, root, visiting);
    const memberVisiting =
      resolved.reference === undefined
        ? visiting
        : new Set([...visiting, resolved.reference]);
    const memberNode =
      member === node
        ? member
        : resolved.recursive
          ? {}
          : mergedAllOf(resolved.node, root, memberVisiting);
    if (isObject(memberNode.properties)) {
      Object.assign(properties, memberNode.properties);
    }
    if (Array.isArray(memberNode.required)) {
      const memberRequired: unknown[] = memberNode.required;
      for (const name of memberRequired) {
        required.add(name);
      }
    }
  }
  const { allOf: _allOf, ...rest } = node;
  return Object.keys(properties).length === 0
    ? rest
    : { ...rest, properties, required: [...required] };
}

function pluralType(type: string): string {
  if (type === "any") {
    return "values";
  }
  if (type.startsWith('"') || type.includes(" ")) {
    return `items of ${type}`;
  }
  return type.endsWith("s") ? type : `${type}s`;
}

function typeName(
  schema: unknown,
  root: JsonObject,
  visiting: ReadonlySet<string>,
  depth: number,
): string {
  if (
    schema === true ||
    (isObject(schema) && Object.keys(schema).length === 0)
  ) {
    return "any";
  }
  if (schema === false) {
    return "never";
  }
  if (!isObject(schema)) {
    return "unknown";
  }
  if (depth > maximumDepth) {
    return "…";
  }
  const resolved = resolveReference(schema, root, visiting);
  if (resolved.recursive && resolved.reference !== undefined) {
    return referenceName(resolved.reference);
  }
  const nextVisiting =
    resolved.reference === undefined
      ? visiting
      : new Set([...visiting, resolved.reference]);
  const node = mergedAllOf(resolved.node, root, nextVisiting);
  const nestedName = (nested: unknown) =>
    typeName(nested, root, nextVisiting, depth + 1);
  const arrayName = () => {
    if (node.items === undefined) {
      return "array";
    }
    if (Array.isArray(node.items)) {
      const items: unknown[] = node.items;
      return `tuple of ${items.map(nestedName).join(", ")}`;
    }
    return `array of ${pluralType(nestedName(node.items))}`;
  };
  if (Object.hasOwn(node, "const")) {
    return literal(node.const);
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return node.enum.map(literal).join(" | ");
  }
  const alternatives = variants(node);
  if (alternatives !== undefined) {
    return [...new Set(alternatives.map(nestedName))].join(" | ");
  }
  const type = node.type;
  if (Array.isArray(type)) {
    const names = type
      .filter((item): item is string => typeof item === "string")
      .map((item) => (item === "array" ? arrayName() : item));
    return names.length === 0 ? "any" : names.join(" | ");
  }
  if (type === "array") {
    return arrayName();
  }
  if (type === "object" || isObject(node.properties)) {
    if (!isObject(node.properties) && isObject(node.additionalProperties)) {
      return `object with ${nestedName(node.additionalProperties)} values`;
    }
    return "object";
  }
  return typeof type === "string" ? type : "any";
}

const unboundedLimits = new Set([
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
]);

function constraintNotes(node: JsonObject): string[] {
  const notes: string[] = [];
  const bound = (key: string, symbol: string) => {
    const value = node[key];
    if (typeof value === "number" && !unboundedLimits.has(value)) {
      notes.push(`${symbol} ${value}`);
    }
  };
  bound("minimum", "≥");
  bound("exclusiveMinimum", ">");
  bound("maximum", "≤");
  bound("exclusiveMaximum", "<");
  const count = (key: string, label: string) => {
    const value = node[key];
    if (typeof value === "number") {
      notes.push(`${label} ${value}`);
    }
  };
  count("minLength", "min length");
  count("maxLength", "max length");
  count("minItems", "min items");
  count("maxItems", "max items");
  if (typeof node.format === "string") {
    notes.push(`format ${node.format}`);
  }
  if (typeof node.pattern === "string") {
    notes.push(`pattern "${node.pattern.replaceAll("\n", "\\n")}"`);
  }
  if (Object.hasOwn(node, "default")) {
    notes.push(`default ${literal(node.default)}`);
  }
  if (node.deprecated === true) {
    notes.push("deprecated");
  }
  return notes;
}

/** The object schema whose properties appear nested under a property, if any. */
function nestedObject(
  node: JsonObject,
  root: JsonObject,
  visiting: ReadonlySet<string>,
): { node: JsonObject; visiting: ReadonlySet<string> } | undefined {
  const resolved = resolveReference(node, root, visiting);
  if (resolved.recursive) {
    return undefined;
  }
  const nextVisiting =
    resolved.reference === undefined
      ? visiting
      : new Set([...visiting, resolved.reference]);
  const merged = mergedAllOf(resolved.node, root, nextVisiting);
  if (isObject(merged.properties)) {
    return { node: merged, visiting: nextVisiting };
  }
  const items = merged.items;
  if (isObject(items)) {
    return nestedObject(items, root, nextVisiting);
  }
  const alternatives = variants(merged);
  if (alternatives !== undefined) {
    const objects = alternatives
      .filter(isObject)
      .map((variant) => nestedObject(variant, root, nextVisiting))
      .filter((variant) => variant !== undefined);
    return objects.length === 1 ? objects[0] : undefined;
  }
  return undefined;
}

function muted(text: string): TextSegment {
  return { text, tone: "muted" };
}

function listedObjectVariants(
  node: JsonObject,
  root: JsonObject,
  visiting: ReadonlySet<string>,
): number {
  return (variants(node) ?? []).filter(
    (variant) =>
      isObject(variant) && nestedObject(variant, root, visiting) !== undefined,
  ).length;
}

/** Lists an object schema's properties, or each option of a union, indented by depth. */
function propertyLines(
  objectSchema: JsonObject,
  root: JsonObject,
  visiting: ReadonlySet<string>,
  depth: number,
): TextLine[] {
  if (depth > maximumDepth) {
    return [[plain(`${indentText(depth)}…`)]];
  }
  const properties = objectSchema.properties;
  if (!isObject(properties)) {
    return (variants(objectSchema) ?? []).flatMap((variant, index) => {
      const heading: TextLine = [
        plain(indentText(depth)),
        { text: `Option ${index + 1}`, tone: "name" },
      ];
      const nested = isObject(variant)
        ? nestedObject(variant, root, visiting)
        : undefined;
      const lines =
        nested === undefined
          ? []
          : propertyLines(nested.node, root, nested.visiting, depth + 1);
      return lines.length > 0
        ? [heading, ...lines]
        : [
            [
              ...heading,
              muted(`  ${typeName(variant, root, visiting, depth)}`),
            ],
          ];
    });
  }
  const required = new Set(
    Array.isArray(objectSchema.required)
      ? objectSchema.required.filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  );
  return Object.entries(properties).flatMap(([name, property]) => {
    const resolved = isObject(property)
      ? mergedAllOf(
          resolveReference(property, root, visiting).node,
          root,
          visiting,
        )
      : {};
    const details = [
      typeName(property, root, visiting, depth),
      ...(required.has(name) ? ["required"] : []),
      ...constraintNotes(resolved),
    ];
    const heading: TextLine = [
      plain(indentText(depth)),
      { text: name, tone: "name" },
      { text: `  ${details.join(", ")}`, tone: "muted" },
    ];
    const nested = isObject(property)
      ? nestedObject(property, root, visiting)
      : undefined;
    const childLines =
      nested !== undefined
        ? propertyLines(nested.node, root, nested.visiting, depth + 1)
        : listedObjectVariants(resolved, root, visiting) > 1
          ? propertyLines(resolved, root, visiting, depth + 1)
          : [];
    return [
      heading,
      ...descriptionLines(resolved.description, depth + 1),
      ...childLines,
    ];
  });
}

function rawSchemaLines(schema: JsonObject): TextLine[] {
  return [
    [muted("OpenCode reported this input schema:")],
    ...JSON.stringify(schema, undefined, indentWidth)
      .split("\n")
      .map((line) => [muted(line)]),
  ];
}

function capped(lines: TextLine[]): TextLine[] {
  if (lines.length <= maximumLines) {
    return lines;
  }
  return [
    ...lines.slice(0, maximumLines),
    [muted(`… ${lines.length - maximumLines} more lines not shown.`)],
  ];
}

function rootLines(schema: JsonObject): TextLine[] {
  const nested = nestedObject(schema, schema, new Set());
  if (nested !== undefined) {
    const lines = propertyLines(nested.node, schema, nested.visiting, 0);
    if (lines.length > 0) {
      return lines;
    }
  }
  const resolved = resolveReference(schema, schema, new Set()).node;
  const alternatives = variants(mergedAllOf(resolved, schema, new Set()));
  const informative = alternatives?.some((variant) => {
    const type = typeName(variant, schema, new Set(), 0);
    return (
      (type !== "object" && type !== "any") ||
      (isObject(variant) &&
        nestedObject(variant, schema, new Set()) !== undefined)
    );
  });
  if (alternatives !== undefined && informative === true) {
    return [
      [muted("Takes one of these inputs:")],
      ...propertyLines(
        mergedAllOf(resolved, schema, new Set()),
        schema,
        new Set(),
        0,
      ),
    ];
  }
  const type = typeName(schema, schema, new Set(), 0);
  if (type === "object" || type === "any") {
    return hasCombinators(resolved)
      ? rawSchemaLines(schema)
      : [[muted("Takes no input.")]];
  }
  return [[plain("Input is "), { text: type, tone: "name" }]];
}

/** Renders a tool's input JSON schema as indented, readable lines. */
export function schemaLines(schema: unknown): TextLine[] {
  if (!isObject(schema)) {
    return [[muted("OpenCode did not report an input schema.")]];
  }
  try {
    return capped(rootLines(schema));
  } catch {
    return capped(rawSchemaLines(schema));
  }
}

export function linesText(lines: readonly TextLine[]): string {
  return lines
    .map((line) => line.map((segment) => segment.text).join(""))
    .join("\n");
}
