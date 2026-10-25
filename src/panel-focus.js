// Disabled controls can drop browser focus to body. Restore only that lost
// focus, never a user who moved to another live control while work was pending.
export function capturePanelFocus(ids,fallback){
 const doc=globalThis.document,initial=doc?.activeElement;
 if(!initial||!ids.includes(initial.id))return ()=>{};
 return preferred=>{
  if(doc.activeElement!==doc.body&&doc.activeElement!==initial)return;
  const target=[preferred,initial,fallback].find(element=>element&&!element.disabled);
  target?.focus();
 };
}
