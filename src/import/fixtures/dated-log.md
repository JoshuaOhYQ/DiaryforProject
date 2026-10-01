# Voice subsystem log

Author: Sample Student

## Mon 14 Sep 2026 — Whisper set-up (2.5h)

Installed Whisper and ran it on recorded test phrases.

**Problem:** Transcription took 9 seconds per phrase on the laptop CPU.
**Fix:** Switched to the `base.en` model, now about 2 seconds.
**Result:** 18 of 20 test phrases transcribed correctly.
Next: try the GPU build on the lab PC.
Tags: whisper, stt

## 2026-09-16

### What I did
- Wrote a wrapper that streams microphone audio to Whisper
- Read about voice activity detection, see https://example.com/vad-notes

### Problems
Clipping at the start of each phrase.

### How I fixed it
Added 300 ms of pre-roll buffer.

Hours: 3
Type: Build
