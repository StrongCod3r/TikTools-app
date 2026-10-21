import { computed, ref, shallowRef, type Ref } from 'vue';
import { defaultWidgetLayers, updateWidgetLayer } from '../../../../widgets/sdk/layers.ts';
import type { WidgetLayer, WidgetLayerSeed, WidgetStyle, WidgetTemplateToken } from '../../../../widgets/sdk/template.ts';
import { widgetTemplates, type WidgetKind } from '../../../../widgets/sdk/templates.ts';
import { orderedTextFields, textDefaults, type TextField } from '../../../../widgets/sdk/text.ts';
import { cloneDesign, EditorHistory } from '@/entities/overlay/lib/editor-history.ts';
import { designDefaults, isStructuralControl, withoutKeys, type DesignDefaults, type ScalarControl } from '../lib/design-controls.ts';

export const TEXT_MAX_LENGTH = 300;
export const LAYER_NAME_MAX_LENGTH = 80;
const INPUT_COALESCE_MS = 800;

interface Snapshot {
  draft: WidgetStyle;
  visible: TextField[];
}

export interface DesignEditorLabels {
  layer: (seed: WidgetLayerSeed) => string;
  newLayer: (kind: WidgetLayer['kind']) => string;
  newText: () => string;
}

export type Placement = 'top' | 'bottom';

export function useDesignEditor(kind: Readonly<Ref<WidgetKind>>, source: Readonly<Ref<WidgetStyle>>, labels: DesignEditorLabels) {
  const template = computed(() => widgetTemplates[kind.value]);
  const schema = computed(() => template.value.schema);
  const defaults = computed(() => designDefaults(schema.value));
  const textFields = computed(() => [...schema.value.textFields]);
  const draft = ref<WidgetStyle>({});
  const visibleFields = ref<TextField[]>([]);
  const history = shallowRef(new EditorHistory<Snapshot>());
  const revision = ref(0);
  let baseline = '{}';
  let lastKey = '';
  let lastAt = 0;

  const canUndo = computed(() => (void revision.value, history.value.canUndo));
  const canRedo = computed(() => (void revision.value, history.value.canRedo));
  const dirty = computed(() => JSON.stringify(draft.value) !== baseline);
  const orderedVisible = computed(() =>
    orderedTextFields(textFields.value, draft.value.textOrder).filter((field) => visibleFields.value.includes(field)),
  );
  const hiddenFields = computed(() => textFields.value.filter((field) => !visibleFields.value.includes(field)));
  const removableFields = computed(() => new Set(textFields.value.filter((field) => !schema.value.requiredTextFields.includes(field))));
  const layers = computed(() => draft.value.layers ?? defaultWidgetLayers(kind.value, schema.value, draft.value, labels.layer));
  const sections = computed(() =>
    schema.value.editorSections.filter(
      (section) => section.id !== 'heading' || section.textFields.some((field) => visibleFields.value.includes(field)),
    ),
  );
  const fieldDefaults = computed<Partial<Record<TextField, string>>>(() => textDefaults[kind.value]);

  function load(): void {
    draft.value = cloneDesign(source.value);
    baseline = JSON.stringify(draft.value);
    visibleFields.value = textFields.value.filter((field) => !draft.value.hiddenText?.includes(field));
    history.value = new EditorHistory<Snapshot>();
    lastKey = '';
    revision.value += 1;
  }

  function snapshot(): Snapshot {
    return { draft: cloneDesign(draft.value), visible: [...visibleFields.value] };
  }

  function restore(state: Snapshot | null): void {
    if (state) {
      draft.value = state.draft;
      visibleFields.value = state.visible;
    }
    lastKey = '';
    revision.value += 1;
  }

  function change(key: string, mutate: () => void, coalesceMs = 0): void {
    const before = snapshot();
    mutate();
    const now = Date.now();
    if (!(coalesceMs > 0 && key === lastKey && now - lastAt < coalesceMs)) history.value.commit(before);
    lastKey = key;
    lastAt = now;
    revision.value += 1;
  }

  const undo = (): void => restore(history.value.undo(snapshot()));
  const redo = (): void => restore(history.value.redo(snapshot()));

  function setScalar(control: ScalarControl, key: string, value: ReturnType<ScalarControl['get']>): void {
    const apply = control.set as (design: WidgetStyle, next: typeof value, d: DesignDefaults) => WidgetStyle;
    const coalesce = control.kind === 'range' || control.kind === 'color' ? INPUT_COALESCE_MS : 0;
    change(key, () => {
      draft.value = apply(draft.value, value, defaults.value);
    }, coalesce);
  }

  function setHidden(hidden: readonly TextField[]): void {
    const next = { ...draft.value };
    if (hidden.length === 0) delete next.hiddenText;
    else next.hiddenText = textFields.value.filter((field) => hidden.includes(field));
    draft.value = next;
  }

  function textOf(field: TextField): string {
    return draft.value.text?.[field] ?? fieldDefaults.value[field] ?? '';
  }

  function setText(field: TextField, value: string): void {
    change(`text:${field}`, () => {
      draft.value = { ...draft.value, text: { ...draft.value.text, [field]: value.slice(0, TEXT_MAX_LENGTH) } };
    }, INPUT_COALESCE_MS);
  }

  function insertToken(field: TextField, token: WidgetTemplateToken, start: number, end: number): number {
    const current = textOf(field);
    const snippet = `{{${token}}}`;
    const next = current.slice(0, start) + snippet + current.slice(end);
    if (next.length > TEXT_MAX_LENGTH) return start;
    change(`token:${field}`, () => {
      draft.value = { ...draft.value, text: { ...draft.value.text, [field]: next } };
    });
    return start + snippet.length;
  }

  function removeField(field: TextField): void {
    change(`field:remove:${field}`, () => {
      const text = { ...draft.value.text };
      delete text[field];
      draft.value = { ...draft.value, text };
      setHidden([...(draft.value.hiddenText ?? []), field]);
      visibleFields.value = visibleFields.value.filter((item) => item !== field);
    });
  }

  function addField(field: TextField, placement: Placement): void {
    change('field:add', () => {
      const order = orderedTextFields(textFields.value, draft.value.textOrder).filter((item) => item !== field);
      const visible = order.filter((item) => visibleFields.value.includes(item));
      const hidden = order.filter((item) => !visibleFields.value.includes(item));
      draft.value = {
        ...draft.value,
        textOrder: placement === 'top' ? [field, ...visible, ...hidden] : [...visible, field, ...hidden],
      };
      visibleFields.value = [...visibleFields.value, field];
      setHidden((draft.value.hiddenText ?? []).filter((item) => item !== field));
    });
  }

  function moveField(field: TextField, direction: -1 | 1): void {
    const visible = orderedVisible.value;
    const index = visible.indexOf(field);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= visible.length) return;
    change('field:order', () => {
      const next = [...visible];
      [next[index], next[target]] = [next[target]!, next[index]!];
      draft.value = { ...draft.value, textOrder: [...next, ...hiddenFields.value] };
    });
  }

  function editLayer(id: string, key: string, patch: Partial<WidgetLayer>): void {
    change(`layer:${id}:${key}`, () => {
      draft.value = { ...draft.value, layers: updateWidgetLayer(layers.value, id, (layer) => ({ ...layer, ...patch })) };
    }, INPUT_COALESCE_MS);
  }

  function moveLayer(id: string, direction: -1 | 1): void {
    const current = layers.value;
    const index = current.findIndex((layer) => layer.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    change('layers:move', () => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      draft.value = { ...draft.value, layers: next };
    });
  }

  function removeLayer(id: string): void {
    change('layers:remove', () => {
      draft.value = { ...draft.value, layers: layers.value.filter((layer) => layer.id !== id) };
    });
  }

  function addLayer(layerKind: WidgetLayer['kind'], placement: Placement): string {
    const current = layers.value;
    const label = labels.newLayer(layerKind);
    let number = 1;
    while (current.some((layer) => layer.name === `${label} ${number}`)) number += 1;
    let id: string;
    do id = `layer:${Math.random().toString(36).slice(2, 12)}`;
    while (current.some((layer) => layer.id === id));
    const layer: WidgetLayer = { id, kind: layerKind, name: `${label} ${number}` };
    if (layerKind === 'text') layer.text = labels.newText();
    else layer.size = layerKind === 'art' ? 88 : defaults.value.avatarSize;
    change('layers:add', () => {
      draft.value = { ...draft.value, layers: placement === 'top' ? [layer, ...current] : [...current, layer] };
    });
    return id;
  }

  function sectionResetKeys(sectionId: string, controls: Readonly<Record<string, ScalarControl>>): string[] {
    const section = schema.value.editorSections.find((item) => item.id === sectionId);
    if (!section) return [];
    const keys = section.groups.flatMap((group) =>
      group.controls.flatMap((control) => {
        if (control === 'layers') return ['layers'];
        if (control === 'textFields') return ['textOrder', ...textFields.value.map((field) => `text.${field}`)];
        if (isStructuralControl(control)) return [];
        return [...(controls[control]?.resetKeys ?? [])];
      }),
    );
    return [...new Set(keys)];
  }

  function resetSection(sectionId: string, controls: Readonly<Record<string, ScalarControl>>): void {
    const keys = sectionResetKeys(sectionId, controls);
    change('reset', () => {
      draft.value = withoutKeys(draft.value, keys);
      const restored = textFields.value.filter((field) => keys.includes(`text.${field}`));
      if (restored.length > 0) {
        const hidden = new Set(draft.value.hiddenText ?? []);
        restored.forEach((field) => hidden.delete(field));
        setHidden([...hidden]);
        visibleFields.value = textFields.value.filter((field) => !hidden.has(field));
      }
    });
  }

  function resetDesign(): void {
    change('reset', () => {
      draft.value = {};
      visibleFields.value = [...textFields.value];
    });
  }

  load();

  return {
    template,
    schema,
    defaults,
    draft,
    dirty,
    canUndo,
    canRedo,
    sections,
    layers,
    orderedVisible,
    hiddenFields,
    removableFields,
    load,
    undo,
    redo,
    setScalar,
    textOf,
    setText,
    insertToken,
    removeField,
    addField,
    moveField,
    editLayer,
    moveLayer,
    removeLayer,
    addLayer,
    sectionResetKeys,
    resetSection,
    resetDesign,
  };
}

export type DesignEditor = ReturnType<typeof useDesignEditor>;
