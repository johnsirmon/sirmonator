# Character voice iteration 3

1. Preserve the accepted Prime voice and both version 2 references/auditions. Offer an edition selector for auditions and full readings.
2. Keep Prime's reference and unfiltered timbre. Test four flow sampling steps with temperature 0.65 for steadier delivery.
3. Rebuild Grit & Grace from open, assertive Marcus dialogue rather than hushed reassurance. Test four steps and temperature 0.60. Do not add pitch lowering, distortion, bass, or tremolo.
4. Run the same worker implementation in browser and audition generation. Verify exact input reconstruction, output audio, edition switching, reference assets, tempo, and full readings. Retain sentence/paragraph pauses without changing the manuscript.
5. Publish tested samples with version 2 available for comparison. These are listening candidates, not a certified improvement in speaker similarity. John will judge the character resemblance.

Sampling controls are supported by [Pocket TTS's official API](https://github.com/kyutai-labs/pocket-tts/blob/main/docs/API%20Reference/python-api.md). More steps cost CPU time; lower temperature reduces sampling variation but does not guarantee naturalness or word accuracy.
