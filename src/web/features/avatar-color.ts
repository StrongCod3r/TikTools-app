const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #ff0050, #00f2fe)',
  'linear-gradient(135deg, #fe2c55, #ff7e40)',
  'linear-gradient(135deg, #69c9d0, #0070f3)',
  'linear-gradient(135deg, #9b51e0, #fe2c55)',
  'linear-gradient(135deg, #ff007a, #7928ca)',
  'linear-gradient(135deg, #00c9ff, #92fe9d)',
  'linear-gradient(135deg, #f857a6, #ff5858)',
  'linear-gradient(135deg, #ff8a00, #e52e71)',
  'linear-gradient(135deg, #06d6a0, #118ab2)',
] as const;

/** Stable fallback color so an avatar-less user keeps one identity across
 *  the feed row and the details panel. */
export function avatarFallbackColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx] ?? AVATAR_GRADIENTS[0];
}
