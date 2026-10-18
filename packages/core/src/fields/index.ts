/** Contact fields: the typed registry behind identify attributes (see registry.ts). */

export {
  type ContactField,
  type FieldPatch,
  fieldTypes,
  getField,
  inferFieldType,
  listFields,
  MAX_FIELDS,
  recordFields,
  updateField,
} from './registry.js';
export {
  ATTRIBUTE_PREFIX,
  BUILTIN_FIELDS,
  BUILTIN_KEYS,
  type BuiltinField,
  FIELD_SOURCES,
  FIELD_TYPES,
  type FieldRef,
  type FieldSource,
  type FieldType,
  fieldKeyForAttribute,
  labelForKey,
  resolveFieldRef,
} from './types.js';
