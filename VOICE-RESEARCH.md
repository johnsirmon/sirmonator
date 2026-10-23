# Natural character voices: research and implementation

Research date: October 23, 2026. The application presets remain **unofficial character impressions**, with variable resemblance. They are not certified reproductions or official performances.

## Why the first attempt sounded masked

The original Prime preset resampled a generic narrator at 0.79× pitch, boosted bass, added saturation, and applied ring modulation. Marcus used 0.83× pitch, bass boost, and saturation. This shifts formants as well as pitch: it changes the size and color of the apparent vocal tract, producing the disguise quality the user reported. A generic speaker with those effects cannot acquire another speaker's articulation, accent, or prosody.

The implementation now replaces both effect presets with **Pocket TTS reference conditioning**. The selected speech reference is encoded into the model's voice state. New speech comes directly from that conditioned model, without pitch lowering, bass boost, distortion, ring modulation, or reverb added by this application. Speed changes use pitch-preserving WSOLA tempo adjustment through SoundTouchJS; at 1×, its processing is bypassed.

## Performance references

- **Optimus Prime / Peter Cullen:** [Cullen explains creating Optimus at TFcon](https://www.youtube.com/watch?v=zryfjSaxXLo). He attributes the character to his brother's gentle advisory manner, rather than theatrical shouting. That supports targeting calm authority and clear articulation rather than extra bass and metallic effects. The short conditioning reference is a [spoken character excerpt](https://www.101soundboards.com/sounds/480877-freedom-is-the-right-of-all-sentient-beings), about 5.7 seconds. Inferences about the target delivery are design judgments, not an acoustic similarity score.
- **Marcus Fenix / John DiMaggio:** [Gears of War 2 behind-the-scenes interview](https://www.youtube.com/watch?v=IHc7ILzNO2E). DiMaggio discusses building the character through attitude and performance, and demonstrates the voice. The conditioning reference joins two short dialogue excerpts: [careful and quiet](https://www.101soundboards.com/sounds/618522-marcus-we-need-to-be-careful-and-quiet) and [reassurance](https://www.101soundboards.com/sounds/618534-marcus-you-did-what-you-had-to-do). These were selected over one-word catchphrases to provide more articulation and a calmer reading register.

Source clips are short excerpts for reference conditioning and comparison. Transformers/Optimus Prime, Gears of War/Marcus Fenix, and the original performances belong to their respective owners. The application's MIT license does not relicense those recordings or imply endorsement. Source provenance is exposed in the optional reference comparison beneath each character voice.

## Free approaches considered

| Approach | What it can do | Fit for this application |
| --- | --- | --- |
| Kokoro + effects | Free preset voices; no reference voice cloning | Retained for ten regular narrators. Pitch effects cannot accurately reproduce a character. |
| Supertonic 3 | Free preset speaker styles; local ONNX speech | Retained for ten narrators. Uses CPU/WASM after a real GPU-device-loss failure. Its original online Voice Builder is discontinued. |
| Pocket TTS | Reference-based voice cloning, compact CPU inference, browser community ports | Selected for both characters. No server or paid API needed. |
| Qwen3-TTS Base / VoiceDesign | Reference cloning and detailed voice design; 0.6B / 1.7B variants | Promising higher-capacity route, but its documented Python/GPU deployment is a larger runtime than this GitHub Pages/iPhone flow. Not silently substituted as a paid cloud service. |

Primary technical sources: [Kyutai Pocket TTS report](https://kyutai.org/pocket-tts-technical-report/), [official Pocket repository and browser implementation links](https://github.com/kyutai-labs/pocket-tts#in-browser-implementations), [browser API and cloning example](https://github.com/vlapky/pocket-tts-js#english--voice-cloning), [Qwen3-TTS voice cloning and voice design](https://github.com/QwenLM/Qwen3-TTS#voice-clone), [Supertonic archived service notice](https://github.com/supertone-oss-archive/supertonic#models--versions).

## Reproducibility and limits

- `pocket-tts-js` is pinned to 0.1.0. ONNX assets are pinned to `vlapky/pocket-tts-onnx` revision `c469236dbc5f68287fa2fbf175b66de3b80123af`, English April 2026, INT8. This community browser export is not represented as the latest official Kyutai checkpoint.
- Code license: MIT. Downloaded Pocket model/voice assets: CC-BY-4.0 according to the model/export documentation. Kyutai is credited in the app. SoundTouchJS: LGPL-2.1; its notice is retained in `src/vendor/SOUNDTOUCH-LICENSE`, with package/source information in `package-lock.json`.
- Browser inference uses WASM, one thread, with caching. About 150 MB is downloaded once for character synthesis. Auditions remain small checked-in WAVs and require no model startup.
- `node scripts/generate-character-auditions.mjs` recreates the two auditions using the same reference clips, model revision, tokenizer, and inference implementation on the Node CPU runtime. Internal runtime adaptations and model cache remain ignored in `.cache/`.
- Reference quality, recording conditions, and model capacity affect resemblance. This is a more suitable method than pitch masking, not evidence of an exact match. Automated tests verify routing, audio validity, lack of masking effects, and pitch-preserving speed adjustment; they do not certify perceptual similarity.
- The manuscript is still partitioned with exact text reconstruction before speech. There is no chat model that rewrites the sermon. Neural speech models can nevertheless mispronounce, repeat, or skip words. The downloadable transcript records the supplied text, not a verified transcription of the recording.

## Reliability fix delivered first

The preceding release removed speech synthesis from auditions entirely, checked all 22 samples for real media playback, and switched Supertonic to CPU/WASM. GPU recovery now covers inference-time loss as well as model loading, retrying the same passage once on CPU. See `tests/recovery.test.js` and `tests/audition-assets.test.js`.
