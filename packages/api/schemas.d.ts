import type { RequestBodies } from './requests.js';
export const bodies: { [K in keyof RequestBodies]: Record<string, unknown> };
