# Documentation

Start here, then follow the decision records for the reasoning.

| Document | What it answers |
| --- | --- |
| [Product definition](product.md) | Who Weft is for, what it must do, what we deliberately do not do, and the exit criteria for the first version. |
| [Architecture](architecture.md) | How the system is shaped: components, document model, real-time layer, agent surface, rendering, extraction, and risks. |
| [CLI](cli.md) | Commands, JSON output, exit codes, and how agents should use the headless client. |
| [Decision records](decisions/README.md) | What we chose, why, what we rejected, and what it costs. |
| [Project history](HISTORY.md) | The timeline linking eras, stack changes, and decisions. |
| [Changelog](../CHANGELOG.md) | What shipped, in user-facing prose. |

## Reading order for a new contributor

1. The [README](../README.md) for the pitch and the name.
2. [Product definition](product.md) for the target.
3. [ADR 0002](decisions/0002-design-files-as-plain-text.md) for the decision that shapes the whole system.
4. [ADR 0003](decisions/0003-document-schema-v1.md) for the concrete file, node and serialization model.
5. [ADR 0004](decisions/0004-headless-cli-and-design-io.md) for the headless-first tooling boundary.
6. [ADR 0005](decisions/0005-command-protocol.md) for the mutation API and inverse-based undo.
7. [Architecture](architecture.md) for the draft implementation shape.
8. [CLI](cli.md) to run, inspect and edit a design.
9. [ADR index](decisions/README.md) to see which decisions are settled and which are still open.
