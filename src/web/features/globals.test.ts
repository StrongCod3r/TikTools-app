import { expect, test } from 'bun:test';

import { globalSuggestionItems } from './globals.ts';

test('globals build sorted universal autocomplete rows', () => {
  const items = globalSuggestionItems({ commandPort: '46665', commandHost: '127.0.0.1' }, 'en');
  expect(items.map((item) => item.value)).toEqual(['globals.commandHost', 'globals.commandPort']);
  expect(items[0]?.label).toBe('commandHost');
  expect(items[1]?.kind).toBe('number');
  expect(items[1]?.preview).toBe('46665');
});
