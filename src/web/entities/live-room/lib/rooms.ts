import type { LiveChannel } from '@/types.ts';

export function dedupeRooms(rooms: readonly LiveChannel[]): LiveChannel[] {
  const seen = new Set<string>();
  return rooms.filter((room) => {
    const key = room.roomId || room.uniqueId;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function chooseRandomRoom(
  rooms: readonly LiveChannel[],
  currentCreator: string,
  random: () => number = Math.random,
): LiveChannel | null {
  const current = currentCreator.replace(/^@/, '').toLowerCase();
  const eligible = rooms.filter((room) => room.uniqueId.toLowerCase() !== current);
  const pool = eligible.length > 0 ? eligible : rooms;
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)] ?? null;
}
