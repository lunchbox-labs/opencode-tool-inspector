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
/**
 * Caps the reference lookups behind one schema, so schemas whose references fan out are cut
 * short instead of stalling the TUI.
 */
const maximumReferenceLookups = 50_000;

/** Thrown when a schema would take more lines or lookups than a detail view shows. */
class SchemaTooLarge extends Error {}

interface Rendering {
  root: JsonObject;
  lines: TextLine[];
  remainingLookups: number;
  /** Where each shared definition's fields were first listed, by its reference. */
  listedDefinitions: Map<string, string>;
}

function write(rendering: Rendering, line: TextLine): void {
  if (rendering.lines.length >= maximumLines) {
    throw new SchemaTooLarge();
  }
  rendering.lines.push(line);
}

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

function muted(text: string): TextSegment {
  return { text, tone: "muted" };
}

function indentText(depth: number): string {
  return " ".repeat(depth * indentWidth);
}

function writeDescription(
  rendering: Rendering,
  description: unknown,
  depth: number,
): void {
  if (typeof description !== "string" || description.trim() === "") {
    return;
  }
  for (const line of description.trim().split(/\r?\n/)) {
    write(rendering, [plain(`${indentText(depth)}${line}`)]);
  }
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

/** Keys beside a `$ref` that change its target's shape, so it no longer reads as that definition. */
const shapeKeys = new Set([
  "properties",
  "required",
  "items",
  "prefixItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "oneOf",
]);

interface Resolved {
  node: JsonObject;
  visiting: ReadonlySet<string>;
  /** The shared definition this node is, unchanged, when it came from a reference. */
  definition?: string;
  /** The reference that points back into a definition being expanded, if this node is one. */
  recursiveReference?: string;
}

/** Resolves local `$ref`s, as zod and MCP servers emit for shared definitions. */
function resolveReference(
  node: JsonObject,
  rendering: Rendering,
  visiting: ReadonlySet<string>,
): Resolved {
  rendering.remainingLookups--;
  if (rendering.remainingLookups < 0) {
    throw new SchemaTooLarge();
  }
  const reference = node.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#")) {
    return { node, visiting };
  }
  if (visiting.has(reference)) {
    return { node, visiting, recursiveReference: reference };
  }
  let target: unknown = rendering.root;
  for (const rawKey of reference.slice(1).split("/").filter(Boolean)) {
    const key = decodedPointerKey(rawKey)
      .replaceAll("~1", "/")
      .replaceAll("~0", "~");
    target = isObject(target) ? target[key] : undefined;
  }
  if (!isObject(target)) {
    return { node, visiting };
  }
  const siblings = withoutReference(node);
  return {
    node: { ...target, ...siblings },
    visiting: new Set([...visiting, reference]),
    ...(Object.keys(siblings).some((key) => shapeKeys.has(key))
      ? {}
      : { definition: reference }),
  };
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
  rendering: Rendering,
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
    let memberNode = member;
    if (member !== node) {
      const resolved = resolveReference(member, rendering, visiting);
      memberNode =
        resolved.recursiveReference === undefined
          ? mergedAllOf(resolved.node, rendering, resolved.visiting)
          : {};
    }
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
  rendering: Rendering,
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
  const resolved = resolveReference(schema, rendering, visiting);
  if (resolved.recursiveReference !== undefined) {
    return referenceName(resolved.recursiveReference);
  }
  const node = mergedAllOf(resolved.node, rendering, resolved.visiting);
  const nestedName = (nested: unknown) =>
    typeName(nested, rendering, resolved.visiting, depth + 1);
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

/** An object schema to list fields from, and the shared definition it is, if any. */
interface FieldSource {
  node: JsonObject;
  visiting: ReadonlySet<string>;
  definition?: string;
}

/** The object schema whose properties appear nested under a property, if any. */
function nestedObject(
  node: JsonObject,
  rendering: Rendering,
  visiting: ReadonlySet<string>,
): FieldSource | undefined {
  const resolved = resolveReference(node, rendering, visiting);
  if (resolved.recursiveReference !== undefined) {
    return undefined;
  }
  const merged = mergedAllOf(resolved.node, rendering, resolved.visiting);
  // An empty `properties` beside a union, as some schema generators emit, defers to the union.
  if (
    isObject(merged.properties) &&
    (Object.keys(merged.properties).length > 0 ||
      variants(merged) === undefined)
  ) {
    return {
      node: merged,
      visiting: resolved.visiting,
      definition: resolved.definition,
    };
  }
  const items = merged.items;
  if (isObject(items)) {
    return nestedObject(items, rendering, resolved.visiting);
  }
  const alternatives = variants(merged);
  if (alternatives !== undefined) {
    const objects = alternatives
      .filter(isObject)
      .map((variant) => nestedObject(variant, rendering, resolved.visiting))
      .filter((variant) => variant !== undefined);
    return objects.length === 1 ? objects[0] : undefined;
  }
  return undefined;
}

function listedObjectVariants(
  node: JsonObject,
  rendering: Rendering,
  visiting: ReadonlySet<string>,
): number {
  return (variants(node) ?? []).filter(
    (variant) =>
      isObject(variant) &&
      nestedObject(variant, rendering, visiting) !== undefined,
  ).length;
}

/** Whether listing a union option says more than "object". */
function informativeVariant(
  variant: unknown,
  rendering: Rendering,
  visiting: ReadonlySet<string>,
): boolean {
  const type = typeName(variant, rendering, visiting, 0);
  return (
    (type !== "object" && type !== "any") ||
    (isObject(variant) &&
      nestedObject(variant, rendering, visiting) !== undefined)
  );
}

/** The union of several object options under a property, following array items, if any. */
function objectUnion(
  node: JsonObject,
  rendering: Rendering,
  visiting: ReadonlySet<string>,
): FieldSource | undefined {
  const resolved = resolveReference(node, rendering, visiting);
  if (resolved.recursiveReference !== undefined) {
    return undefined;
  }
  const merged = mergedAllOf(resolved.node, rendering, resolved.visiting);
  if (listedObjectVariants(merged, rendering, resolved.visiting) > 1) {
    return {
      node: merged,
      visiting: resolved.visiting,
      definition: resolved.definition,
    };
  }
  // A nullable union wraps the union beside a null option.
  const present = (variants(merged) ?? []).filter(
    (variant) => !(isObject(variant) && variant.type === "null"),
  );
  if (present.length === 1 && isObject(present[0])) {
    return objectUnion(present[0], rendering, resolved.visiting);
  }
  return isObject(merged.items)
    ? objectUnion(merged.items, rendering, resolved.visiting)
    : undefined;
}

/**
 * Lists an object schema's properties, then each option of a union beside them, indented by
 * depth.
 */
function writeProperties(
  rendering: Rendering,
  objectSchema: JsonObject,
  visiting: ReadonlySet<string>,
  depth: number,
  path: string,
): void {
  if (depth > maximumDepth) {
    write(rendering, [plain(`${indentText(depth)}…`)]);
    return;
  }
  /**
   * Lists a field's or option's own fields one level deeper, or, for a shared definition already
   * listed, where its fields are.
   */
  const writeFields = (source: FieldSource, sourcePath: string) => {
    const listedAt =
      source.definition === undefined
        ? undefined
        : rendering.listedDefinitions.get(source.definition);
    if (listedAt !== undefined) {
      write(rendering, [
        plain(indentText(depth + 1)),
        muted(`Same fields as ${listedAt}.`),
      ]);
      return;
    }
    const linesBefore = rendering.lines.length;
    writeProperties(
      rendering,
      source.node,
      source.visiting,
      depth + 1,
      sourcePath,
    );
    if (
      source.definition !== undefined &&
      depth < maximumDepth &&
      rendering.lines.length > linesBefore
    ) {
      rendering.listedDefinitions.set(source.definition, sourcePath);
    }
  };
  const alternatives = variants(objectSchema);
  // Options are listed only when at least one says more than "object".
  const listedOptions =
    alternatives?.some((variant) =>
      informativeVariant(variant, rendering, visiting),
    ) === true
      ? alternatives
      : [];
  const properties = isObject(objectSchema.properties)
    ? Object.entries(objectSchema.properties)
    : [];
  if (properties.length > 0) {
    const required = new Set(
      Array.isArray(objectSchema.required)
        ? objectSchema.required.filter(
            (name): name is string => typeof name === "string",
          )
        : [],
    );
    for (const [name, property] of properties) {
      const resolved = isObject(property)
        ? mergedAllOf(
            resolveReference(property, rendering, visiting).node,
            rendering,
            visiting,
          )
        : {};
      const details = [
        typeName(property, rendering, visiting, depth),
        ...(required.has(name) ? ["required"] : []),
        ...constraintNotes(resolved),
      ];
      write(rendering, [
        plain(indentText(depth)),
        { text: name, tone: "name" },
        muted(`  ${details.join(", ")}`),
      ]);
      writeDescription(rendering, resolved.description, depth + 1);
      const fields = isObject(property)
        ? (nestedObject(property, rendering, visiting) ??
          objectUnion(property, rendering, visiting))
        : undefined;
      if (fields !== undefined) {
        writeFields(fields, path === "" ? name : `${path}.${name}`);
      }
    }
    if (listedOptions.length > 0) {
      write(rendering, [plain(indentText(depth)), muted("And one of:")]);
    }
  }
  listedOptions.forEach((variant, index) => {
    const heading: TextLine = [
      plain(indentText(depth)),
      { text: `Option ${index + 1}`, tone: "name" },
    ];
    write(rendering, heading);
    const linesAfterHeading = rendering.lines.length;
    const fields = isObject(variant)
      ? nestedObject(variant, rendering, visiting)
      : undefined;
    if (fields !== undefined) {
      writeFields(
        fields,
        `${path === "" ? "" : `${path} `}option ${index + 1}`,
      );
    }
    if (rendering.lines.length === linesAfterHeading) {
      rendering.lines[linesAfterHeading - 1] = [
        ...heading,
        muted(`  ${typeName(variant, rendering, visiting, depth)}`),
      ];
    }
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

function rootLines(rendering: Rendering, schema: JsonObject): TextLine[] {
  const noneVisiting = new Set<string>();
  const nested = nestedObject(schema, rendering, noneVisiting);
  if (nested !== undefined) {
    writeProperties(rendering, nested.node, nested.visiting, 0, "");
    if (rendering.lines.length > 0) {
      return rendering.lines;
    }
  }
  const resolved = resolveReference(schema, rendering, noneVisiting).node;
  const merged = mergedAllOf(resolved, rendering, noneVisiting);
  const informative = variants(merged)?.some((variant) =>
    informativeVariant(variant, rendering, noneVisiting),
  );
  if (informative === true) {
    write(rendering, [muted("Takes one of these inputs:")]);
    writeProperties(rendering, merged, noneVisiting, 0, "");
    return rendering.lines;
  }
  const type = typeName(schema, rendering, noneVisiting, 0);
  if (type === "object" || type === "any") {
    return hasCombinators(resolved)
      ? capped(rawSchemaLines(schema))
      : [[muted("Takes no input.")]];
  }
  return [[plain("Input is "), { text: type, tone: "name" }]];
}

/**
 * Renders a tool's input JSON schema as indented, readable lines. A shared definition's fields
 * are listed once, and a schema too large to show is cut short with a note.
 */
export function schemaLines(schema: unknown): TextLine[] {
  if (!isObject(schema)) {
    return [[muted("OpenCode did not report an input schema.")]];
  }
  const rendering: Rendering = {
    root: schema,
    lines: [],
    remainingLookups: maximumReferenceLookups,
    listedDefinitions: new Map(),
  };
  try {
    return rootLines(rendering, schema);
  } catch (error) {
    if (error instanceof SchemaTooLarge && rendering.lines.length > 0) {
      return [
        ...rendering.lines,
        [muted("… Schema too large to show in full.")],
      ];
    }
    return capped(rawSchemaLines(schema));
  }
}

export function linesText(lines: readonly TextLine[]): string {
  return lines
    .map((line) => line.map((segment) => segment.text).join(""))
    .join("\n");
}
