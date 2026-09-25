export interface MemoryFragment {
  id: string;
  content: string;
  time?: string;
}
export interface Mind {
  schema_version: '1.0';
  slug: string;
  version: string;
  name: string;
  description: string;
  language?: string;
  persona: { instructions: string; self_description?: string; values?: string[] };
  memory: { fragments: MemoryFragment[] };
  assets: Record<string, string>;
  capabilities: ['text-chat'];
  extensions?: Record<string, unknown>;
}
export interface Publication {
  listed: boolean;
  chat: boolean;
  download: boolean;
  github: boolean;
  memory_ids: string[];
  asset_keys: string[];
  compliance_confirmed?: boolean;
}
export type PublicationChoices = Partial<Publication>;
export const mindSchema: Record<string, unknown>;
export const assetMaxBytes: number;
export function emptyMind(slug?: string): Mind;
export function skillSlug(id: string): string;
export function skillSubmissionIssues(mind: Mind): string[];
export function defaultPublication(mind: Mind): PublicationChoices;
export function publicationSettings(mind: Mind, choices: PublicationChoices): Publication;
export function parseMind(source: unknown, slug?: string): { mind: Mind; warnings: string[] };
export function skillMarkdown(mind: Mind): string;
