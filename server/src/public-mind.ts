// Shared projection for public preview, downloads and conversation context.
export function publicMind(content:any,publication:any){
  const m=structuredClone(content);m.memory.fragments=m.memory.fragments.filter((x:any)=>(publication.memory_ids||[]).includes(x.id));
  m.assets=Object.fromEntries(Object.entries(m.assets).filter(([k])=>(publication.asset_keys||[]).includes(k)));
  delete m.extensions;return m;
}
