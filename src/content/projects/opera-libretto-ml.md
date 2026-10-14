---
title: "Libretto: Interactive Opera Study Companion & Linguistic Inspector"
date: "2026-07-15"
tags: ["Digital Humanities", "Linguistics", "NLP", "Web Speech API", "React", "TypeScript"]
featured: true
order: 4
category: "digital-humanities"
summary: "An interactive, linguistically annotated dual-column opera study companion with word-by-word grammatical breakdowns, native text-to-speech pronunciation, and complete corpora for Mozart, Wagner, Verdi, and Beethoven."
thumbnail: "/images/libretto_companion.png"
heroImage: "/images/libretto_companion.png"
liveUrl: "https://libretto-eight.vercel.app/"
githubUrl: "https://github.com/schochdo/Libretto"
---

An open-source, interactive linguistic reading companion and study tool engineered for opera lovers, singers, conductors, musicologists, and language learners.

### Project Overview
Standard bilingual librettos offer static, literal translations that obscure the underlying syntax, poetic elisions, and archaic grammar of original 18th- and 19th-century German and Italian texts. **Libretto** bridges the gap between hearing the music and truly mastering the language by providing line-by-line syntax-faithful translations, tokenized grammatical breakdowns, native pronunciation audio, and dramaturgical context.

### Complete 100% Annotated Repertoire
The library features unabridged, token-level annotated librettos for foundational masterworks:
- **Die Zauberflöte** (*W. A. Mozart / Emanuel Schikaneder, 1791*): Acts I & II complete (1,361 lines, 770 cues, full 1791 spoken dialogue).
- **Tannhäuser** (*Richard Wagner, 1845*): Acts I, II & III complete (965 lines, full Venusberg & Wartburg contest).
- **Falstaff** (*Giuseppe Verdi / Arrigo Boito, 1893*): Acts I, II & III complete (1,887 lines, 6 parts, Boito poetic text).
- **Fidelio** (*Ludwig van Beethoven / Sonnleithner & Treitschke, 1814*): Acts I & II complete (920 lines, full spoken dialogue & dungeon drama).

### Key Architectural & User Experience Features
- **Dual-Column Synchronized Reading**: Original German/Italian text paired with direct, syntax-faithful English translations.
- **Interactive Linguistic Inspector**: Click any word token to inspect:
  - Base lemma and dictionary entry.
  - Part of speech (Noun, Verb, Adjective, Pronoun, Preposition).
  - Literal meaning vs. poetic/contextual translation.
  - Granular grammatical commentary (case endings, archaic elisions, subjunctive moods, German separable prefix verbs, Italian poetic apocope).
- **Native Speech Synthesis (TTS)**: In-browser audio pronunciation using HTML5 Web Speech API with native German and Italian system voices and speed controls.
- **Stage Directions & Voice Attributions**: Scene settings, character voice type designations (Soprano, Mezzo, Tenor, Baritone, Bass), and rapid act/scene navigation.
- **5 Ergonomic Reading Themes**: Night (OLED dark), Sepia (warm paper), Parchment (classic), Ivory, and High Contrast with dynamic font scaling (0.8x to 1.5x).
- **Zero-Backend Architecture**: 100% client-side single-page application built with React, TypeScript, and Vite.
