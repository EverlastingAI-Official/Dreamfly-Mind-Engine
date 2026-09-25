import type { Mind, PublicationChoices } from './types.js';
// Shared projection for public preview, downloads and conversation context.
export function publicMind(content: Mind, publication: PublicationChoices): Mind {
  const mind = structuredClone(content);
  mind.memory.fragments = mind.memory.fragments.filter((fragment) =>
    (publication.memory_ids || []).includes(fragment.id),
  );
  mind.assets = Object.fromEntries(
    Object.entries(mind.assets).filter(([key]) => (publication.asset_keys || []).includes(key)),
  );
  delete mind.extensions;
  return mind;
}
