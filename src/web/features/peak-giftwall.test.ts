import { expect, test } from 'bun:test';
import profile from '../../../examples/profiles/peak-giftwall.tikprofile.json';
import manifest from '../../../examples/peak-game/plugin.json';
import { instantiateProfile, parseRuleProfile } from './rule-profiles.ts';

test('PEAK giftwall imports safely and exposes editable live catalog actions', () => {
  const parsed = parseRuleProfile(profile);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const rules = instantiateProfile(parsed.profile);
  expect(rules).toHaveLength(10);
  for (const entry of parsed.profile.templates) {
    expect(entry.template.event.enabled).toBe(false);
    expect(entry.template.event.cooldownMs).toBeGreaterThanOrEqual(5000);
    for (const action of entry.template.actions) {
      const descriptor = manifest.actionTypes.find((a) => a.id === action.typeId);
      expect(descriptor).toBeDefined();
      expect(Number(action.config.quantity)).toBeLessThanOrEqual(5);
    }
  }
});

test('all PEAK actions opt into authenticated idempotent JSON requests', () => {
  expect(manifest.actionTypes).toHaveLength(5);
  expect(manifest.http.auth.tokenSetting).toBe('apiToken');
  expect(manifest.settings.schema.properties.apiToken.secret).toBe(true);
  for (const action of manifest.actionTypes) {
    expect(action.http.method).toBe('POST');
    expect(action.http.idempotency.enabled).toBe(true);
    expect(action.http.idempotency.header).toBe('Idempotency-Key');
    expect(action.http.headers['Content-Type']).toBe('application/json');
    expect(action.requiredCapabilities).toEqual(['http.request']);
  }
});

test('every PEAK action sends a validated position', () => {
  for (const action of manifest.actionTypes) {
    if (!action.http.path.startsWith('/api/spawn/')) continue;
    expect(action.http.bodyVariants).toBeDefined();
    expect(action.http.bodyVariants.field).toBe('positionMode');
    const values = action.http.bodyVariants.values;
    expect(Object.keys(values)).toContain('near_player');
    expect(Object.keys(values)).toContain('random_player');
    expect(Object.keys(values)).toContain('world_position');
    for (const variant of Object.values(values)) {
      expect(variant.position.mode).toBeDefined();
    }
  }
});

test('PEAK option sources read the endpoints PEAKapi actually serves', () => {
  const paths = new Set<string>();
  for (const action of manifest.actionTypes) {
    for (const source of Object.values(action.optionSources ?? {})) {
      paths.add(source.path);
    }
  }
  expect(paths.has('/api/catalog/items')).toBe(true);
  expect(paths.has('/api/catalog/entities')).toBe(true);
  expect(paths.has('/api/catalog/hazards')).toBe(true);
  expect(paths.has('/api/players')).toBe(true);
  expect(paths.has('/api/entities')).toBe(true);
});

test('PEAK discovers the BepInEx configuration of the game', () => {
  expect(manifest.http.tokenImport.format).toBe('ini');
  expect(manifest.http.tokenImport.fileName).toBe('org.peak.rest-api.cfg');
  expect(manifest.http.tokenImport.section).toBe('HTTP');
  expect(manifest.http.tokenImport.key).toBe('AuthenticationToken');
  expect(manifest.http.tokenImport.discovery.steamFolder).toBe('PEAK');
  expect(manifest.http.tokenImport.discovery.modManagerGame).toBe('PEAK');
  expect(manifest.http.tokenImport.discovery.relativePath).toBe(
    'BepInEx/config/org.peak.rest-api.cfg',
  );
  expect(manifest.http.tokenImport.connection.setting).toBe('serverUrl');
  expect(manifest.http.tokenImport.connection.hostKey).toBe('Host');
  expect(manifest.http.tokenImport.connection.portKey).toBe('Port');
  expect(manifest.http.health.path).toBe('/health');
  expect(manifest.http.health.readinessField).toBe('gameplayReady');
});
