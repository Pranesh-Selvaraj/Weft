# Product definition

## One sentence

Weft is a browser-native design canvas whose files live in the repository and are readable and writable by any coding agent, so design, agent assistance, and implementation share one source of truth.

## The problem

Design tools were optimized for a world where only humans touched the artifact. The design file is an opaque cloud binary; coding agents can neither see it nor change it without a proprietary integration, and the implementation lives somewhere else entirely. The result is a handoff made of screenshots, redlines, ticket references, and an agent that can only work from prose.

Meanwhile, more design changes now start with a conversation — "make this hero shorter", "try the other spacing" — and end with a person translating that conversation into both a design and code. Weft collapses the distance between those two outputs.

## People

### The product designer

Works in the browser, extracts the current product into frames, iterates on layout and content, and asks the agent to apply changes without leaving the file. Cares about fidelity, speed, and not maintaining a parallel universe of stale screens.

### The developer

Wants the design as structured data and as an implementation starting point. Wants the agent to keep the design and the code in sync, and wants every design change reviewable in git.

### The agent

Receives a stable, documented interface: a file format, a tool contract, and a live channel. It should never need to scrape the canvas or guess at pixel values.

## Jobs to be done

- "Take these pages of our running product and turn them into a design file I can open and edit."
- "Show me this screen at mobile and desktop, then ask the agent to adapt it."
- "Put a comment on this card and have the agent change the real component."
- "Give the agent the design so it can build the page instead of reinterpreting a screenshot."
- "Let a teammate join this design file from a URL while I keep editing."
- "Show me what changed in this design between two commits."

## Product principles

- **The design file is the interface.** Every capability — human edit, agent edit, export, review — is a view over the same document.
- **Agents are collaborators with a paper trail.** Their edits are attributed, reviewable, and undoable, exactly like a person's.
- **Extraction beats recreation.** Capturing the real product is more accurate and faster than redrawing it.
- **One canvas, two audiences.** Designers see frames and layers; agents see nodes and properties; neither gets a second-class artifact.
- **Local-first.** Opening, editing, and saving work without a server; collaboration and remote agents are additive.

## Non-goals for the first version

- Full vector illustration and pen-tool parity with mature design tools.
- A plugin marketplace or a proprietary extension runtime.
- Video prototyping, 3D, and advanced motion design.
- Hosted multi-tenant SaaS, billing, and organization administration.
- Pixel-perfect import of existing Figma files.

Design files being text does not mean hand-writing JSON is the primary workflow; the editor remains the main surface.

## MVP exit criteria

The first version is done when all of these are true in a fresh checkout:

1. **Open and edit.** `weft dev` serves the editor; a design file opens in the browser; a designer creates a frame, adds a text node and a rectangle, and reloads without losing work.
2. **Real-time.** Two browser tabs on the same file show each other's cursors and edits within a second; a third tab opened offline catches up on reconnect.
3. **Agent reads.** An external harness (pi or opencode) connected over MCP lists the frames in the file and reads a frame's nodes without opening the editor.
4. **Agent writes.** The same harness creates a frame and changes a text node; the browser reflects the change live, attributed to the agent.
5. **Chat in the file.** A designer selects a node, asks the in-canvas agent to change it, and the agent performs the edit through the same tool contract as an external harness.
6. **Extract a page.** The extractor captures one running page (markup, computed styles, assets) into frames at two viewports; the frames render in the canvas, and the captured content is readable as structured data by an agent.
7. **Round trip.** The agent reads the extracted frame and the designer's annotations, edits the host application source, and a new capture is visibly closer to the annotated intent.
8. **Git.** The design file is reviewed as a diff, committed, and reopened from the repository on a second machine.
9. **Export.** Design tokens export to CSS custom properties, and one frame exports to HTML/CSS that a developer can start from.

## Success signals after the MVP

- A designer can extract and iterate a real page without leaving the browser.
- A developer prefers the Weft file over a screenshot when handing work to an agent.
- An agent can make a useful design change with zero harness-specific instructions beyond the tool contract.
- A design file survives two people and one agent editing concurrently without losing an edit.

## Open questions

- Does the source of truth stay JSON for large files, or does the editor need a binary sidecar for performance?
- How much of an extracted page should become editable native nodes versus remain a fidelity-preserving snapshot?
- Should in-canvas chat drive the user's installed harness, a hosted model, or both?
- What is the minimal renderer that is honest about CSS layout without reimplementing a browser?
- How do we keep agent edits reviewable when an agent rewrites a whole page?
- Which parts of a design file are safe for an agent to write directly, and which need an approval step?
