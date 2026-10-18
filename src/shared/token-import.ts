export type TokenSetupOptions = { mode: 'file' | 'folder' | 'auto' | 'candidate'; candidateId?: string };
export type TokenSetupCandidate = { id: string; label: string };
export type PluginCredentialState = { working: boolean; ok: boolean; message: string; candidates?: TokenSetupCandidate[] };
