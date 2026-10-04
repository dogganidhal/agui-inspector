// Response schemas for interrupt answers (FR-023). Framework-free and pure: no network, no client.
//
// The protocol carries an interrupt's `responseSchema` opaquely, so the inspector uses it only to help
// the person answering: it prefills the editor from the schema and warns when the answer misses it.
// Neither is a validator and neither ever stops an answer from being sent.
import type { JsonObject, JsonValue } from '../../contracts.ts';
import { isJsonValue, isRecord } from '../config/validation.ts';

type Schema = Readonly<Record<string, unknown>>;
const asSchema = (value: unknown): Schema | undefined => (isRecord(value) ? value : undefined);
const MAX_DEPTH = 8;

function typeOf(schema: Schema): string | undefined {
  const { type } = schema;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.find((entry): entry is string => typeof entry === 'string' && entry !== 'null') ?? 'null';
  return schema.properties !== undefined ? 'object' : schema.items !== undefined ? 'array' : undefined;
}

/**
 * A starting answer for an interrupt: the schema's `default`, `const` or first `enum` value where it
 * names one, otherwise the empty value of the declared type, with object properties filled in. The
 * result is a draft the user edits. It becomes an answer when the user presses Resolve, or when the profile
 * says to resolve and has no payload for the interrupt's reason.
 */
export function seedFromSchema(schema: JsonObject | undefined, depth = 0): JsonValue {
  const spec = asSchema(schema);
  if (spec === undefined) return {};
  if (isJsonValue(spec.default) && 'default' in spec) return spec.default;
  if ('const' in spec && isJsonValue(spec.const)) return spec.const;
  if (Array.isArray(spec.enum) && spec.enum.length > 0 && isJsonValue(spec.enum[0])) return spec.enum[0];
  const choice = [spec.oneOf, spec.anyOf].find(Array.isArray);
  if (choice !== undefined && asSchema(choice[0]) !== undefined && depth < MAX_DEPTH) return seedFromSchema(choice[0] as JsonObject, depth + 1);

  switch (typeOf(spec)) {
    case 'object': {
      const properties = asSchema(spec.properties) ?? {};
      return depth >= MAX_DEPTH ? {} : Object.fromEntries(Object.entries(properties).map(([name, sub]) => [name, seedFromSchema(asSchema(sub) as JsonObject, depth + 1)]));
    }
    case 'array':
      return [];
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return depth === 0 ? {} : null;
  }
}

const describeType: Record<string, string> = {
  string: 'text',
  number: 'a number',
  integer: 'a whole number',
  boolean: 'true or false',
  object: 'an object',
  array: 'a list',
  null: 'null',
};

function kindOf(value: JsonValue): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

function matchesType(value: JsonValue, type: string): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return kindOf(value) === type;
}

/**
 * The first way `value` misses `schema`, or undefined. Covers the keywords an answer form needs: type,
 * enum, const, required, properties and items. It is a hint for the person editing, not a validator:
 * the protocol carries the schema opaquely, so a miss warns and never stops an answer being sent.
 */
export function checkAgainstSchema(value: JsonValue, schema: JsonObject | undefined, path = 'The answer', depth = 0): string | undefined {
  const spec = asSchema(schema);
  if (spec === undefined || depth > MAX_DEPTH) return undefined;
  const types = Array.isArray(spec.type) ? spec.type.filter((entry): entry is string => typeof entry === 'string') : typeof spec.type === 'string' ? [spec.type] : [];
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return `${path} must be ${types.map((type) => describeType[type] ?? type).join(' or ')}. The interrupt's response schema requires it.`;
  }
  if (Array.isArray(spec.enum) && !spec.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    return `${path} must be one of ${spec.enum.map((option) => JSON.stringify(option)).join(', ')}. The interrupt's response schema requires it.`;
  }
  if ('const' in spec && JSON.stringify(spec.const) !== JSON.stringify(value)) {
    return `${path} must be ${JSON.stringify(spec.const)}. The interrupt's response schema requires it.`;
  }
  if (isRecord(value)) {
    const required = Array.isArray(spec.required) ? spec.required.filter((name): name is string => typeof name === 'string') : [];
    const missing = required.find((name) => !(name in value));
    if (missing !== undefined) return `${path === 'The answer' ? '' : `${path}.`}${missing} is required. The interrupt's response schema requires it.`;
    const properties = asSchema(spec.properties) ?? {};
    for (const [name, sub] of Object.entries(properties)) {
      if (!(name in value)) continue;
      const problem = checkAgainstSchema(value[name] as JsonValue, asSchema(sub) as JsonObject, path === 'The answer' ? name : `${path}.${name}`, depth + 1);
      if (problem) return problem;
    }
  }
  if (Array.isArray(value) && asSchema(spec.items) !== undefined) {
    for (const [index, item] of value.entries()) {
      const problem = checkAgainstSchema(item, spec.items as JsonObject, `${path}[${index}]`, depth + 1);
      if (problem) return problem;
    }
  }
  return undefined;
}

