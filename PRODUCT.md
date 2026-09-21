# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One operator: Brad DiPaolo, solo founder of CandidateHub, who will also run further ventures (web projects, AI consulting) from the same tool. He works from one Mac, at a desk, every day. Confirmed as a single-operator product for now; other users (teammates, clients) are an open decision.

## Product Purpose

Hermy HQ is a business OS and mission control for a self-hosted Hermes agent. It shows what needs the operator today (follow-ups, pipeline, approvals), lets them dispatch work to Hermes, and keeps every outward-facing action behind their explicit approval. Success is a founder who starts the day here and knows what to do next.

## Positioning

The agent drafts, the human sends. Hermes runs on the operator's own machine, the data lives in the operator's own Postgres and Obsidian vault, and nothing is sent, posted or paid without approval.

## Operating Context

Runs locally: Next.js dev server on 127.0.0.1 (no login), Postgres and Hermes in Docker on the same Mac, a bridge process that calls the `hermes` CLI, and an Obsidian vault (CandidateHub) that holds the agent's wiki. The Mac has 8 GB RAM, so local models and services must be light.

## Capabilities and Constraints

- The main Hermes agent is called Friday and acts as the operator's chief of staff. Her identity is defined in `SOUL.md` (British, plain claims, short answers, delegates to @mason for sales, @tony for engineering, @paula for design).
- Friday can be talked to from the top of the Today page, by text or voice. Spoken replies come from a local open-source text-to-speech engine (Kokoro, British female voice). Confirmed choices; the engine and voice are replaceable.
- Voice is additive: everything spoken is also shown as text.
- Reply latency is bounded by Hermes itself (one agent run per turn); there is no token streaming yet.
- Speech-to-text uses the browser's built-in recognition where available; a fully local option is undecided.

## Brand Commitments

- Name: Hermy HQ; agent name: Friday.
- The operator supplied a reference image for the Friday panel: a cyan holographic "Jarvis" command-center HUD with a glowing neural-sphere core. Binding as the direction for that panel only; the rest of the dashboard keeps its existing look.

## Evidence on Hand

- Friday's identity and voice notes: `~/.hermes-docker/SOUL.md` and the vault's `Raw/Sources/friday-soul.md`.
- The reference image (attached by the operator in conversation; not stored in the repo).
- No user research, testimonials or usage data exist; none should be invented.

## Product Principles

1. Human approval for anything outward-facing.
2. Local-first and private by default.
3. Short, plain, truthful answers; depth only when asked.
4. Show the operator their next action before anything else.

## Accessibility & Inclusion

Voice and motion are optional layers over a fully usable text interface. Respect reduced-motion preferences; keep the panel keyboard-operable and screen-reader legible.
