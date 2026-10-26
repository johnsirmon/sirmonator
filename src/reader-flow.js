// Navigation only: draft, recording and worker ownership stay in main.js.
export const readerStages = ['add-text', 'choose-voice', 'create-audio', 'listen'];

export function installReaderFlow(document, window) {
  const $ = id => document.getElementById(id);
  const reader = $('reader');
  const panels = readerStages.map($);
  if (panels.some(panel => !panel)) return;
  // Create was nested inside Voice. Keep the same nodes and event handlers.
  panels[1].after(panels[2]);
  panels[2].classList.add('card');
  const publishing = document.createElement('details');
  const publishingTitle = document.createElement('summary');
  publishingTitle.textContent = 'Optional: prepare a podcast episode';
  publishing.append(publishingTitle, $('podcast-prep'));
  panels[3].append(publishing, reader.querySelector('.publishing-help'));
  reader.classList.add('staged-reader');
  let current = readerStages.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'add-text';
  const links = [...reader.querySelectorAll('.steps a')];
  const selection = document.createElement('p'); selection.className = 'notice';
  $('preflight').before(selection);
  function show(stage, focus = true) {
    if (!readerStages.includes(stage)) return;
    current = stage;
    selection.textContent = `${$('title').value.trim() || 'Untitled recording'} · ${$('voice').selectedOptions[0]?.textContent || 'Choose a voice'} · ${$('review').checked ? 'Text reviewed' : 'Review your text in Add text before creating audio'}`;
    for (const panel of panels) panel.hidden = panel.id !== stage;
    for (const link of links) {
      if (link.hash === '#' + stage) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    }
    if (focus) {
      const heading = $(stage).querySelector('h2');
      heading.tabIndex = -1;
      heading.focus({preventScroll:true});
      $(stage).scrollIntoView({block:'start',behavior:'instant'});
    }
  }
  function go(stage) {
    if (window.location.hash === '#' + stage) show(stage);
    else window.location.hash = stage;
  }
  window.addEventListener('hashchange', () => {
    const stage = window.location.hash.slice(1);
    show(readerStages.includes(stage) ? stage : current);
  });
  function button(label, stage) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'secondary'; node.textContent = label;
    node.addEventListener('click', () => go(stage));
    return node;
  }
  panels.forEach((panel, index) => {
    const nav = document.createElement('div'); nav.className = 'flow-actions';
    if (index) nav.append(button('Back: ' + ['Add text','Voice','Create'][index-1], readerStages[index-1]));
    if (index < 3) nav.append(button(['Next: choose a voice','Next: review & create','Listen / saved progress'][index], readerStages[index+1]));
    panel.append(nav);
  });
  const entry = document.createElement('div'); entry.className = 'return-entry';
  entry.append(button('Continue my draft', 'add-text'), button('Listen to saved audio', 'listen'));
  $('library-title').parentElement.append(entry);
  const help = document.createElement('p'); help.className = 'hint flow-help';
  help.textContent = 'Start small: try the example, review the text, audition a voice, then create. Moving between steps keeps your draft and saved audio.';
  reader.querySelector('.steps').after(help);
  const downloadHelp = document.createElement('p'); downloadHelp.className = 'notice';
  downloadHelp.textContent = 'Save for the road: listen and review important passages, then save the MP3 to Files or Downloads. A browser recording is not a backup. Partial audio contains only saved passages; resume creation for the complete sermon.';
  $('listen').querySelector('h2').after(downloadHelp);
  const cacheHelp = document.createElement('p'); cacheHelp.className = 'hint';
  cacheHelp.textContent = 'Audition plays a small bundled sample. Create downloads the selected voice model on first use (about 100–400 MB plus runtime files). Browser caching may avoid another download, but it can be cleared. Keep this page open. Cancel keeps committed passages; Open / resume retries from saved progress.';
  $('preflight').after(cacheHelp);
  // Important creation/recovery messages remain visible from every stage.
  const activity = document.createElement('div'); activity.className = 'flow-activity';
  for (const id of ['storage-state','retry-storage','preparation-status','preparation-meter','status','progress','pause','stop']) activity.append($(id));
  reader.querySelector('.library').after(activity);
  $('open-recording').addEventListener('click', () => go('listen'));
  $('start').addEventListener('click', () => {
    if (!$('review').checked || !$('text').value.trim() || $('text-boundaries').value === 'exact-offsets-240-v1') go('add-text');
  });
  for (const cast of document.querySelectorAll('.casting button')) cast.addEventListener('click', () => go('choose-voice'));
  // Keep expert boundary controls available without dominating the short path.
  const boundaries = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Text compatibility settings'; boundaries.append(summary);
  const boundarySelect = $('text-boundaries');
  const boundaryLabel = document.querySelector('label[for="text-boundaries"]');
  boundaryLabel.before(boundaries);
  boundaries.append(boundaryLabel, boundarySelect, $('boundary-help'));
  // Legacy drafts need this choice visible before a new recording can start.
  const observer = new window.MutationObserver(() => {
    if (boundarySelect.value === 'exact-offsets-240-v1') boundaries.open = true;
  });
  observer.observe($('preflight'), {childList:true,subtree:true,characterData:true});
  show(current, false);
}
