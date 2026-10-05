# Siumora — Coming Soon teaser

Vertical 9:16 for Instagram Reels, YouTube Shorts and WhatsApp status. Target 18 s.
Built on the brand sting's four scenes (Lattice → Chosen → Set → Sign-off) and the voice rules
in `00-guidelines`: warm, plain, a little bold; never "luxury", "premium", "treat yourself".

## What is in this folder

| File | What it is |
|---|---|
| `frame-01-title-9x16.png` | Title frame, brass on Kohl Ink, 1584×2816. Seedream 5.0 Flash, mark PNG as reference. |
| `teaser-01-logo-reveal-9x16.mp4` | Beat 5, the logo reveal, 5.9 s, 768×1364. Minimax Hailuo from the title frame. |

Only beat 5 has been rendered. Beats 1–4 are scripted and costed below.

## Trend format

"Quiet reveal" teaser: black frames, one line of serif text per beat, a slow ASMR-style
product moment, then the logo lands. No voice-over, no countdown, no face. Sound is a single
soft room tone with one metallic "tick" when the kernel lands. Captions are the script, so the
cut works muted.

## Script (18 s)

| Beat | Time | Picture | On-screen text (Cormorant Garamond Light, brass, tracked caps) | Sound |
|---|---|---|---|---|
| 1 Hook | 0.0–3.0 | Black. A single thin brass circle fades in off-centre, drifts toward frame centre along its own axis. | **YOU WERE NOT GIVEN THIS.** | Room tone in |
| 2 Turn | 3.0–6.0 | Three more circles arrive from their own axes and lock into the lattice. Petals appear from the overlaps, never drawn. | **YOU CHOSE IT.** | Low swell |
| 3 Hands | 6.0–10.0 | Macro, Kagaz Ivory tissue with the jaali pattern. A woman's hands lift a thin gold huggie out of a mulberry pouch. Slow, steady, no face. | **925 SILVER · 18K GOLD PVD** | Paper rustle, soft |
| 4 Line | 10.0–12.0 | Black. Text only, one breath. | **BUY IT FOR THE TUESDAY. NOT THE WEDDING.** | Silence, one beat |
| 5 Reveal | 12.0–18.0 | `teaser-01-logo-reveal-9x16.mp4`: polish sweep crosses the brass strokes once, the kernel brightens and rings once. | Wordmark and **SOMETHING GIVEN, SOMETHING KEPT** are in the frame already. Overlay at 15.5 s: **OPENING AUGUST 2026 · SIUMORA.COM** | Single metallic tick at 13.4 s, tone out |

Caption for the post: "Siumora means reward. Everyday jewellery in real metal, for the woman who
no longer waits to be given something. Opening August 2026. First in line gets 15% off the opening edit."

## Edit notes

- Text enters by tracking in from wide to 0.34em, as the wordmark does in the sting. Nothing bounces.
- Only the polish sweep in beat 5 moves across the mark. Circles move along their own axis, never rotate.
- Colour: Kohl Ink `#1C1917` background throughout. Brass `#C79A5C` for type and strokes. Mulberry `#6B2942` only for the pouch in beat 3.
- Hold the final frame 1 s past the overlay before the loop point so Reels' auto-loop reads as a fade.

## Rendering the remaining beats

Account status at time of writing: free plan, 3.35 credits left. Video on this account is limited
to Minimax Hailuo (6 credits per 6 s clip); Kling 3.0 Turbo, Grok Lite, Seedance 2.5 and GPT Image 2.5
return `job_minimum_basic_plan_required`.

Per-clip estimates from `higgsfield generate cost`:

| Model | 5–6 s clip, 720p, 9:16 | Needs |
|---|---|---|
| Minimax Hailuo | 6 credits | free plan |
| Kling 3.0 Turbo | 7.5 credits | Basic plan |
| Seedance 2.5 (default quality) | 35 credits | Basic plan |

Commands, run from the repo root once credits allow:

```bash
# Beat 1–2: lattice assembly from the brass mark (text added in the edit)
higgsfield generate create minimax_hailuo \
  --start-image brand-kit/01-logo/mark/siumora-mark-brass-2048.png \
  --prompt "Black matte background. Four thin brass circle outlines slide in one at a time along their own vertical or horizontal axis and lock into a four-petal lattice; nothing rotates. Static camera, no text, no glow." \
  --wait

# Beat 3: hands and pouch
higgsfield generate create minimax_hailuo \
  --prompt "Macro, overhead, a woman's hands lift a thin 18k gold huggie earring out of a small deep-mulberry fabric pouch resting on ivory tissue paper printed with a repeating four-petal lattice. Soft daylight, slow steady movement, no face, no text." \
  --wait

# Beat 5 (already rendered): job b2be6ae7-7210-4efe-a860-9a8c04800451
```
