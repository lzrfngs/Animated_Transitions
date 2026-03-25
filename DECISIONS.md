# Animated Transitions — Decisions

## What is this
A web tool for creating pixelated greyscale animations at 1024x1024. Type a prompt, see it animate. Choose a pixel mode.

## Stack
- **Rendering:** p5.js (WebGL mode for performance)
- **Animation:** GSAP for easing/timeline control
- **Target:** 60fps+ — fast, slick, no jank

## Interface
- Light background, not dark
- No decoration — functional tool only
- Canvas is the focus, controls are secondary

## Typography
- **Prompt input:** Simple sans-serif (system font stack or Inter)
- **UI labels / mode selector:** Monospace — inspired by Nothing Phone, Teenage Engineering, brutalism
- Small, precise, lowercase where possible

## Pixel Modes
Three selectable rendering styles. Same animation logic, different visual output:

| Mode | Grid | Grey Values | Feel |
|------|------|-------------|------|
| **Glyphs** | 12×12 | 4–6 levels | Nothing OS, ultra-reduced, iconic |
| **Bands** | ~40×40 | ~16 levels | More nuance, banded gradients |
| **Modern** | 100×100 | 256 levels | Full greyscale, tight mosaic |

## Animation System
- Prompt-driven (text input → animation parameters)
- All animations are greyscale
- Continuous loops preferred
- Motion: mechanical, precise, deliberate — no bounce/spring

## Deployment
- Azure Static Web Apps (Free tier)
- Auto-deploys from `chpalazzo_microsoft/Animated_Transitions` on push
- Live URL: `wonderful-mushroom-0e7008610.azurestaticapps.net`

## Later
- Wire up Azure OpenAI to interpret prompts into animation parameters
- Export animations (GIF/MP4)
