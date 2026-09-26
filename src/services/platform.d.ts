import type { ApiClient, ClientSession, SessionDto } from '../../packages/api/index.js';
export const auth: ClientSession;
export const api: ApiClient['api'];
export const sendMessage: ApiClient['sendMessage'];
export function setSession(state: SessionDto | ClientSession): void;
export function clearSession(): void;
export function restoreSession(): Promise<void>;
export function chooseFile(accept: string): Promise<File | undefined>;
