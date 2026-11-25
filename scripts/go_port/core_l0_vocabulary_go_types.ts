#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0VocabularyGoTypes
 * @path scripts/go_port/core_l0_vocabulary_go_types.ts
 * @description Infers Go types for tagged JSON vocabulary values and renders the Go declaration and literal for each constant.
 * Usage: imported by the Go-port scripts.
 */
import type { TTaggedJson } from "./core_l0_vocabulary_symbols.ts";

export interface IGoDeclaration {
  readonly names: readonly string[];
  readonly source: string;
}

export interface IGoRender {
  readonly text: string;
  readonly names: readonly string[];
  readonly tableExpression?: string;
  readonly enumValues?: readonly string[];
  readonly numeric?: boolean;
  readonly usesPointer?: boolean;
}

interface IGoField {
  readonly key: string;
  readonly goName: string;
  readonly type: TGoType;
  readonly nullable: boolean;
}

type TGoScalarKind = "string" | "int" | "float" | "bool" | "null" | "regexp";

type TGoType =
  | { readonly kind: "unknown" }
  | { readonly kind: TGoScalarKind }
  | { readonly kind: "slice"; readonly elem: TGoType }
  | { readonly kind: "map"; readonly elem: TGoType; readonly members: readonly IGoField[] }
  | { readonly kind: "struct"; readonly fields: readonly IGoField[] };

const UNKNOWN: TGoType = { kind: "unknown" };
export const POINTER_HELPER = "vocabularyPointer";

function isTagged(value: TTaggedJson, tag: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && tag in value;
}

function fieldName(key: string): string {
  const name = key.split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : "";
}

function isScalarKind(type: TGoType): boolean {
  return type.kind === "string" || type.kind === "int" || type.kind === "float" || type.kind === "bool";
}

function isAbsent(value: TTaggedJson): boolean {
  return value === null || isTagged(value, "$undefined");
}

/** Infers the Go type of a tagged JSON value. */
function inferType(value: TTaggedJson): TGoType {
  if (isAbsent(value)) return { kind: "null" };
  if (isTagged(value, "$regexp")) return { kind: "regexp" };
  if (isTagged(value, "$set")) return { kind: "slice", elem: { kind: "string" } };
  if (typeof value === "string") return { kind: "string" };
  if (typeof value === "boolean") return { kind: "bool" };
  if (typeof value === "number") return { kind: Number.isInteger(value) ? "int" : "float" };
  if (Array.isArray(value)) return { kind: "slice", elem: value.map(inferType).reduce(unify, UNKNOWN) };
  return inferObject(value as { readonly [key: string]: TTaggedJson });
}

function toField(m: { key: string; type: TGoType; nullable: boolean }): IGoField {
  return { key: m.key, goName: fieldName(m.key), type: m.type, nullable: m.nullable };
}

function inferObject(value: { readonly [key: string]: TTaggedJson }): TGoType {
  const members = Object.entries(value).map(([key, member]) => ({
    key,
    type: inferType(member),
    nullable: isAbsent(member),
  }));
  const elem = commonType(members.map((m) => m.type));
  if (elem && members.length > 0 && elem.kind !== "unknown" && !members.some((m) => m.nullable)) {
    return { kind: "map", elem, members: members.map(toField) };
  }
  return { kind: "struct", fields: members.map(toField) };
}

function commonType(types: readonly TGoType[]): TGoType | undefined {
  try {
    return types.reduce(unify, UNKNOWN);
  } catch {
    return undefined;
  }
}

/** Joins two inferred types and throws when they cannot share one Go type. */
function unify(a: TGoType, b: TGoType): TGoType {
  if (a.kind === "unknown") return b;
  if (b.kind === "unknown") return a;
  if (a.kind === "struct" && b.kind === "struct") return unifyStructs(a.fields, b.fields);
  if (a.kind === "map" && b.kind === "struct") return unifyStructs(a.members, b.fields);
  if (a.kind === "struct" && b.kind === "map") return unifyStructs(a.fields, b.members);
  if (a.kind === "slice" && b.kind === "slice") return { kind: "slice", elem: unify(a.elem, b.elem) };
  if (a.kind === "map" && b.kind === "map") {
    return { kind: "map", elem: unify(a.elem, b.elem), members: unifyMembers(a.members, b.members) };
  }
  if (a.kind === b.kind) return a;
  if (
    isScalarKind(a) && isScalarKind(b) && a.kind !== "bool" && b.kind !== "bool" && a.kind !== "string" &&
    b.kind !== "string"
  ) {
    return { kind: "float" };
  }
  throw new Error(`Cannot unify Go types ${a.kind} and ${b.kind}`);
}

function unifyMembers(a: readonly IGoField[], b: readonly IGoField[]): readonly IGoField[] {
  const shared = a.filter((f) => b.some((g) => g.key === f.key));
  return shared.length === a.length && shared.length === b.length ? a : [];
}

function unifyStructs(a: readonly IGoField[], b: readonly IGoField[]): TGoType {
  const keys = [...new Set([...a, ...b].map((f) => f.key))];
  const fields = keys.map((key) => {
    const left = a.find((f) => f.key === key);
    const right = b.find((f) => f.key === key);
    if (!left || !right) throw new Error(`Struct field ${key} is missing in one value`);
    const merged = left.type.kind === "null"
      ? right.type
      : right.type.kind === "null"
      ? left.type
      : unify(left.type, right.type);
    return { key, goName: left.goName, type: merged, nullable: left.nullable || right.nullable };
  });
  return { kind: "struct", fields };
}

interface IRenderState {
  readonly declared: string[];
  readonly usesPointer: { value: boolean };
}

/** Returns the Go spelling of a type. A struct is named by its path. */
function nameOf(type: TGoType, path: string): string {
  switch (type.kind) {
    case "slice":
      return `[]${nameOf(type.elem, path)}`;
    case "map":
      return `map[string]${nameOf(type.elem, `${path}Entry`)}`;
    case "struct":
      return path;
    case "float":
      return "float64";
    case "int":
    case "bool":
      return type.kind;
    default:
      return "string";
  }
}

function declareStructs(type: TGoType, path: string, state: IRenderState): void {
  if (type.kind === "slice") declareStructs(type.elem, path, state);
  else if (type.kind === "map") declareStructs(type.elem, `${path}Entry`, state);
  else if (type.kind === "struct") {
    const unnamed = type.fields.find((f) => f.goName === "");
    if (unnamed) throw new Error(`Cannot derive a Go field name from ${JSON.stringify(unnamed.key)}`);
    const lines = type.fields.map((f) => {
      const inner = nameOf(f.type, `${path}${f.goName}`);
      return `\t${f.goName} ${f.nullable ? `*${inner}` : inner} \`json:"${f.key}"\``;
    });
    for (const f of type.fields) declareStructs(f.type, `${path}${f.goName}`, state);
    state.declared.push(
      [`// ${path} holds a kept reference record.`, `type ${path} struct {`, ...lines, "}"].join("\n"),
    );
  }
}

function goString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '"' || ch === "\\") out += `\\${ch}`;
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

function literal(value: TTaggedJson, type: TGoType, path: string, state: IRenderState): string {
  const typeName = nameOf(type, path);
  switch (type.kind) {
    case "string":
      return goString(value as string);
    case "regexp":
      return goString((value as { $regexp: string }).$regexp);
    case "int":
    case "float":
      return String(value as number);
    case "bool":
      return String(value);
    case "slice":
      return `${typeName}{${sliceItems(value, type.elem, path, state)}}`;
    case "map":
      return `${typeName}{${mapItems(value as { readonly [key: string]: TTaggedJson }, type.elem, path, state)}}`;
    case "struct":
      return structLiteral(value as { readonly [key: string]: TTaggedJson }, type, path, state);
    default:
      return "nil";
  }
}

function sliceItems(value: TTaggedJson, elem: TGoType, path: string, state: IRenderState): string {
  const items = isTagged(value, "$set") ? (value as { $set: TTaggedJson[] }).$set : (value as readonly TTaggedJson[]);
  return items.map((item) => literal(item, elem, path, state)).join(", ");
}

function mapItems(
  value: { readonly [key: string]: TTaggedJson },
  elem: TGoType,
  path: string,
  state: IRenderState,
): string {
  return Object.entries(value)
    .map(([key, member]) => `${goString(key)}: ${literal(member, elem, `${path}Entry`, state)}`)
    .join(", ");
}

function structLiteral(
  value: { readonly [key: string]: TTaggedJson },
  type: Extract<TGoType, { kind: "struct" }>,
  path: string,
  state: IRenderState,
): string {
  const fields = type.fields.map((f) => {
    const member = value[f.key];
    const fieldPath = `${path}${f.goName}`;
    if (!f.nullable) return `${f.goName}: ${literal(member, f.type, fieldPath, state)}`;
    if (isAbsent(member)) return `${f.goName}: nil`;
    state.usesPointer.value = true;
    return `${f.goName}: ${POINTER_HELPER}(${literal(member, f.type, fieldPath, state)})`;
  });
  return `${path}{${fields.join(", ")}}`;
}

function isRegexpList(value: TTaggedJson): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((v) => isTagged(v, "$regexp"));
}

function renderRegexp(name: string, value: { $regexp: string; flags: string }): IGoRender {
  const lines = [`// ${name} is a kept reference pattern source.`, `const ${name} = ${goString(value.$regexp)}`];
  const names = [name];
  if (value.flags !== "") {
    lines.push("", `// ${name}Flags holds the pattern flags.`, `const ${name}Flags = ${goString(value.flags)}`);
    names.push(`${name}Flags`);
  }
  const flags = value.flags === "" ? '""' : `${name}Flags`;
  return { text: lines.join("\n"), names, tableExpression: `map[string]any{"$regexp": ${name}, "flags": ${flags}}` };
}

function renderRegexpList(name: string, value: readonly { $regexp: string; flags: string }[]): IGoRender {
  const sources = value.map((v) => goString(v.$regexp)).join(", ");
  const flags = value.map((v) => goString(v.flags)).join(", ");
  const text = [
    `// ${name} returns the kept reference pattern sources.`,
    `func ${name}() []string { return []string{${sources}} }`,
    "",
    `// ${name}Flags returns the flags of each pattern.`,
    `func ${name}Flags() []string { return []string{${flags}} }`,
  ].join("\n");
  return { text, names: [name, `${name}Flags`], tableExpression: `regexpList(${name}(), ${name}Flags())` };
}

/** Renders the Go declaration of one kept constant and the table expression that reads it back. */
export function renderConstant(name: string, json: TTaggedJson): IGoRender {
  if (isTagged(json, "$regexp")) return renderRegexp(name, json as { $regexp: string; flags: string });
  if (isRegexpList(json)) return renderRegexpList(name, json as { $regexp: string; flags: string }[]);
  const type = inferType(json);
  const state: IRenderState = { declared: [], usesPointer: { value: false } };
  if (isScalarKind(type)) {
    const text = [`// ${name} is a kept reference constant.`, `const ${name} = ${literal(json, type, name, state)}`];
    return { text: text.join("\n"), names: [name], tableExpression: name };
  }
  const path = `${name}Value`;
  declareStructs(type, path, state);
  const declaration = [
    `// ${name} returns a fresh copy of the kept reference value.`,
    `func ${name}() ${nameOf(type, path)} { return ${literal(json, type, path, state)} }`,
  ].join("\n");
  const text = [...state.declared, declaration].join("\n\n");
  return { text, names: [name], tableExpression: `${name}()`, usesPointer: state.usesPointer.value };
}
