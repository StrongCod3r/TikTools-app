import type { ActionTypeDefinition } from '../../../../automation/behavior/types.ts';
import type { JsonObject, JsonValue } from '../../../../automation/types.ts';
import { variableScopeFor, type VariableScope } from './template-variables.ts';

export interface ActionForm {
  schema: JsonObject;
  uiHints?: JsonObject;
}

function schemaFromFields(type: ActionTypeDefinition): JsonObject {
  const properties: JsonObject = {};
  for (const field of type.fields ?? []) {
    const kind = field.kind;
    properties[field.key] = {
      type: kind === 'number' || kind === 'range' ? 'number' : kind === 'boolean' ? 'boolean' : kind === 'keyvalue' ? 'object' : 'string',
      title: field.label,
      default: field.value,
      minimum: field.min,
      maximum: field.max,
      multipleOf: field.step,
    } as unknown as JsonValue;
  }
  return { type: 'object', properties };
}

function hintsFromFields(type: ActionTypeDefinition): JsonObject {
  const fields: JsonObject = {};
  for (const field of type.fields ?? []) {
    fields[field.key] = {
      kind: field.kind,
      placeholder: field.placeholder,
      template: field.template,
      advanced: field.advanced,
      hint: field.hint,
      showIf: field.showIf,
      options: field.options,
      optionsFrom: field.optionsFrom,
      picker: field.picker,
    } as unknown as JsonValue;
  }
  return { fields };
}

export function actionForm(type: ActionTypeDefinition): ActionForm {
  return {
    schema: type.configSchema ?? schemaFromFields(type),
    uiHints: type.uiHints ?? hintsFromFields(type),
  };
}

const typeScopes: Readonly<Record<string, Readonly<Record<string, VariableScope>>>> = {
  'core.fetch': { url: 'all', body: 'all', headers: 'all', emitResponseAs: 'identity', uniqueId: 'identity' },
  'core.emit': { type: 'identity', data: 'all' },
  'core.points': { uniqueId: 'identity' },
  'core.log': { message: 'all' },
};

export function variableScope(typeId: string, field: string): VariableScope {
  return typeScopes[typeId]?.[field] ?? variableScopeFor(field);
}
