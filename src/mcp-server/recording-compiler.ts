import type { RecordingSession, RecordingInteraction, RecordingPage } from "../shared/types.js";

// --- Public API ---

export interface CompileOptions {
  name: string;
  description?: string;
}

export interface CompileResult {
  skillMarkdown: string;
  name: string;
  pageCount: number;
  interactionCount: number;
}

export function compileRecording(session: RecordingSession, options: CompileOptions): CompileResult {
  const name = sanitizeSkillName(options.name);
  const totalInteractions = session.pages.reduce((sum, p) => sum + p.interactions.length, 0);
  const description = options.description ?? `Replay of a recorded browser session (${session.pages.length} pages, ${totalInteractions} interactions).`;

  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`name: ${name}`);
  lines.push(`description: ${description}`);
  lines.push("allowed-tools: mcp__crawlio-browser__search, mcp__crawlio-browser__execute, mcp__crawlio-browser__connect_tab");
  lines.push("---");
  lines.push("");

  // Title
  const title = options.name.trim() || "Unnamed Skill";
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Replay of a recorded browser session (${session.pages.length} pages, ${totalInteractions} interactions).`);
  lines.push("");

  // Prerequisites
  lines.push("## Prerequisites");
  lines.push("");
  lines.push("Connect to a browser tab before running:");
  lines.push("");
  lines.push("```");
  lines.push(`connect_tab({ url: "${escapeString(session.metadata.initialUrl)}" })`);
  lines.push("```");
  lines.push("");

  // Pages
  for (let i = 0; i < session.pages.length; i++) {
    const page = session.pages[i];
    const pageLabel = page.title || page.url;
    lines.push(`## Page ${i + 1}: ${pageLabel}`);
    lines.push("");
    lines.push("```js");
    for (const interaction of page.interactions) {
      lines.push(compileInteraction(interaction));
    }
    lines.push("```");
    lines.push("");

    // Checkpoint between pages (not after last)
    if (i < session.pages.length - 1) {
      lines.push("```js");
      lines.push("await sleep(1000)");
      lines.push("await smart.snapshot()");
      lines.push("```");
      lines.push("");
    }
  }

  // Session Info
  lines.push("## Session Info");
  lines.push("");
  lines.push(`- **Recorded**: ${session.startedAt}`);
  lines.push(`- **Duration**: ${session.duration}s`);
  lines.push(`- **Stop reason**: ${session.metadata.stopReason}`);
  lines.push("");

  return {
    skillMarkdown: lines.join("\n"),
    name,
    pageCount: session.pages.length,
    interactionCount: totalInteractions,
  };
}

// --- Interaction compiler ---

/** Protocol fields to strip from recorded args before emitting */
const STRIP_KEYS = new Set(["type", "id", "_internal"]);

function filterArgs(args: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!STRIP_KEYS.has(k)) filtered[k] = v;
  }
  return filtered;
}

function resolveSelector(args: Record<string, unknown>): string | undefined {
  const sel = args.selector ?? args.ref;
  return typeof sel === "string" ? sel : undefined;
}

function compileInteraction(interaction: RecordingInteraction): string {
  const args = filterArgs(interaction.args);
  const tool = interaction.tool;

  switch (tool) {
    case "browser_navigate": {
      const url = args.url as string ?? "";
      return `await smart.navigate(${JSON.stringify(url)})`;
    }

    case "browser_click": {
      const sel = resolveSelector(args) ?? "";
      return `await smart.click(${JSON.stringify(sel)})`;
    }

    case "browser_type": {
      const sel = resolveSelector(args) ?? "";
      const text = args.text as string ?? "";
      if (args.clearFirst) {
        return `await smart.type(${JSON.stringify(sel)}, ${JSON.stringify(text)}, { clearFirst: true })`;
      }
      return `await smart.type(${JSON.stringify(sel)}, ${JSON.stringify(text)})`;
    }

    case "browser_evaluate": {
      const expr = args.expression as string ?? "";
      return `await smart.evaluate(${JSON.stringify(expr)})`;
    }

    case "browser_press_key": {
      const bridgeArgs = { type: "browser_press_key", ...args };
      return `await bridge.send(${JSON.stringify(bridgeArgs)})`;
    }

    case "browser_hover": {
      const sel = resolveSelector(args);
      const bridgeArgs = { type: "browser_hover", ...args };
      if (sel) {
        return `await smart.waitFor(${JSON.stringify(sel)})\nawait bridge.send(${JSON.stringify(bridgeArgs)})`;
      }
      return `await bridge.send(${JSON.stringify(bridgeArgs)})`;
    }

    case "browser_select_option": {
      const sel = resolveSelector(args);
      const bridgeArgs = { type: "browser_select_option", ...args };
      if (sel) {
        return `await smart.waitFor(${JSON.stringify(sel)})\nawait bridge.send(${JSON.stringify(bridgeArgs)})`;
      }
      return `await bridge.send(${JSON.stringify(bridgeArgs)})`;
    }

    case "browser_scroll": {
      const bridgeArgs = { type: "browser_scroll", ...args };
      return `await bridge.send(${JSON.stringify(bridgeArgs)})`;
    }

    case "browser_double_click": {
      const sel = resolveSelector(args);
      const bridgeArgs = { type: "browser_double_click", ...args };
      if (sel) {
        return `await smart.waitFor(${JSON.stringify(sel)})\nawait bridge.send(${JSON.stringify(bridgeArgs)})`;
      }
      return `await bridge.send(${JSON.stringify(bridgeArgs)})`;
    }

    case "browser_drag": {
      const bridgeArgs = { type: "browser_drag", ...args };
      return `await bridge.send(${JSON.stringify(bridgeArgs)})`;
    }

    case "browser_fill_form": {
      const bridgeArgs = { type: "browser_fill_form", ...args };
      return `await bridge.send(${JSON.stringify(bridgeArgs)})`;
    }

    case "browser_file_upload": {
      const sel = resolveSelector(args);
      const bridgeArgs = { type: "browser_file_upload", ...args };
      if (sel) {
        return `await smart.waitFor(${JSON.stringify(sel)})\nawait bridge.send(${JSON.stringify(bridgeArgs)})`;
      }
      return `await bridge.send(${JSON.stringify(bridgeArgs)})`;
    }

    // User interaction tools (captured from manual browser events)
    case "user_click": {
      const sel = args.selector as string ?? "";
      return `await smart.click(${JSON.stringify(sel)})`;
    }

    case "user_type": {
      const sel = args.selector as string ?? "";
      const text = args.text as string ?? "";
      return `await smart.type(${JSON.stringify(sel)}, ${JSON.stringify(text)})`;
    }

    case "user_keypress": {
      const key = args.key as string ?? "";
      return `await bridge.send(${JSON.stringify({ type: "browser_press_key", key })})`;
    }

    default:
      return `// Unknown tool: ${tool}`;
  }
}

// --- Helpers ---

export function sanitizeSkillName(raw: string): string {
  let name = raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")       // spaces/underscores → hyphens
    .replace(/[^a-z0-9-]/g, "")    // strip non-alphanumeric (except hyphens)
    .replace(/-{2,}/g, "-")        // collapse consecutive hyphens
    .replace(/^-+|-+$/g, "");      // trim edge hyphens

  if (name.length > 50) name = name.slice(0, 50).replace(/-+$/, "");
  if (!name) name = "unnamed-skill";

  return name;
}

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
