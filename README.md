# Racemake Easy

A simplified telemetry analysis pipeline for **PitGPT** — an AI race engineer that analyzes racing simulator data and generates real-time coaching feedback.

The pipeline takes sector-level telemetry from Spa-Francorchamps (Le Mans Ultimate, Porsche 963 LMdh), compares it against a reference lap, and produces coaching output in two voice modes: analytical (`generic`) and driver-focused (`pitgpt`).

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.10

## Setup

```bash
bun install
```

## Usage

```bash
# Run the analysis pipeline
bun run challenge.ts

# Run tests
bun test

# Lint
bun run lint

# Type check
bun run typecheck
```

## How It Works

The pipeline has four stages:

1. **Types** — Data structures for telemetry, analysis findings, and coaching output
2. **Data** — Reference lap and driver laps at Spa-Francorchamps (sector times, braking points, tyre data, throttle traces)
3. **Analysis** — Detects issues per sector (`late_braking`, `early_lift`, `traction_loss`, `overcorrection`), analyzes single laps and multi-lap stints, and tracks how issues evolve across a stint
4. **Coach** — Generates coaching messages based on findings, supporting both a generic analytical voice and a direct PitGPT race-engineer voice

## Development

This project uses the [Ralph autonomous agent loop](RALPH.md) for task management, with Linear as the task source. Process rules live in `AGENT.md` and `PROMPT.md`.

### Tooling

- **Runtime:** [Bun](https://bun.sh)
- **Language:** TypeScript (strict mode, ESNext)
- **Linting & Formatting:** [Biome](https://biomejs.dev)
- **CI:** GitHub Actions (typecheck, lint, test)
