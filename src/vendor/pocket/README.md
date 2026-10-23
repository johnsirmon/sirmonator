# Pocket worker source

Copied from MIT-licensed `pocket-tts-js@0.1.0` (worker.js, tokenizer.js, binary.js). Original license retained here. Upstream: https://github.com/vlapky/pocket-tts-js

Sirmonator changes: per-edition sampling steps and temperature from `src/character-settings.js`, selected immediately before generation; dispose/rebuild sampling tensors when settings change. Model, tokenization, text handling, voice conditioning, and decoder are unchanged. The public npm client remains pinned; `src/pocket-client.js` overrides its worker factory so the browser and audition generator use this same source. Update the bridge deliberately if changing the upstream client protocol.
