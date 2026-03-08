import { describe, it, expect } from "vitest";

/**
 * Tests for the ARIA snapshot logic extracted from generateAriaSnapshot().
 * We test the pure tree-building and formatting logic independently of CDP.
 */

const ARIA_INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio",
  "combobox", "slider", "tab", "menuitem", "option",
  "switch", "searchbox", "spinbutton",
]);

const ARIA_LANDMARK_ROLES = new Set([
  "heading", "img", "navigation", "main", "banner",
  "contentinfo", "complementary", "form", "region",
]);

const SNAPSHOT_MAX_NODES = 15000;

interface AriaState {
  refMap: Map<string, number>;
  counter: number;
}

/**
 * Pure version of generateAriaSnapshot tree logic for testing.
 * Mirrors the production code in background.ts.
 */
function buildAriaSnapshot(nodes: any[]): { snapshot: string; ariaState: AriaState } {
  if (nodes.length > SNAPSHOT_MAX_NODES) {
    nodes.length = SNAPSHOT_MAX_NODES;
  }

  const ariaState: AriaState = { refMap: new Map(), counter: 0 };

  // Build parent→children map (CDP childIds are unreliable)
  const childrenOf = new Map<string, any[]>();
  let rootNode: any = null;

  for (const node of nodes) {
    if (node.ignored) continue;
    if (node.parentId) {
      if (!childrenOf.has(node.parentId)) childrenOf.set(node.parentId, []);
      childrenOf.get(node.parentId)!.push(node);
    } else {
      rootNode = node;
    }
  }

  // Attach orphans (parent filtered by truncation) to root
  if (rootNode) {
    const knownIds = new Set<string>();
    for (const node of nodes) {
      if (!node.ignored) knownIds.add(node.nodeId);
    }
    for (const node of nodes) {
      if (node.ignored || !node.parentId || node === rootNode) continue;
      if (!knownIds.has(node.parentId)) {
        if (!childrenOf.has(rootNode.nodeId)) childrenOf.set(rootNode.nodeId, []);
        childrenOf.get(rootNode.nodeId)!.push(node);
      }
    }
  }

  function formatNode(node: any, depth: number): string {
    if (node.ignored) return "";
    const role = node.role?.value || "";
    const name = node.name?.value || "";
    const children = childrenOf.get(node.nodeId) || [];

    if (role === "none" || role === "presentation") {
      if (children.length === 0) return "";
      const presentationChildren: string[] = [];
      for (const child of children) {
        const childLine = formatNode(child, depth);
        if (childLine) presentationChildren.push(childLine);
      }
      return presentationChildren.join("\n");
    }
    if (role === "generic" && !name && children.length === 0) return "";

    const indent = "  ".repeat(depth);
    let line = "";
    const isInteractive = ARIA_INTERACTIVE_ROLES.has(role);
    const isLandmark = ARIA_LANDMARK_ROLES.has(role);

    const truncatedName = name.length > 50 ? name.substring(0, 47) + "..." : name;

    if (role && role !== "generic") {
      line = `${indent}${role}`;
      if (truncatedName) line += ` "${truncatedName}"`;
    } else if (truncatedName) {
      line = `${indent}"${truncatedName}"`;
    }

    if ((isInteractive || (isLandmark && name)) && node.backendDOMNodeId) {
      ariaState.counter++;
      const ref = `e${ariaState.counter}`;
      ariaState.refMap.set(ref, node.backendDOMNodeId);
      if (line) line += ` [ref=${ref}]`;
    }

    const childLines: string[] = [];
    for (const child of children) {
      const childLine = formatNode(child, depth + 1);
      if (childLine) childLines.push(childLine);
    }

    if (!line && childLines.length === 0) return "";
    if (!line && childLines.length > 0) return childLines.join("\n");
    if (line && childLines.length > 0) return line + ":\n" + childLines.join("\n");
    return line;
  }

  if (!rootNode) return { snapshot: "(empty page)", ariaState };

  const snapshot = formatNode(rootNode, 0);
  return { snapshot: snapshot || "(empty page)", ariaState };
}

describe("ARIA Snapshot", () => {
  describe("parentId reconstruction", () => {
    it("should build correct tree from flat CDP nodes with parentId", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Test Page" } },
        { nodeId: "2", parentId: "1", role: { value: "navigation" }, name: { value: "Main Nav" }, backendDOMNodeId: 10 },
        { nodeId: "3", parentId: "2", role: { value: "link" }, name: { value: "Home" }, backendDOMNodeId: 11 },
        { nodeId: "4", parentId: "2", role: { value: "link" }, name: { value: "About" }, backendDOMNodeId: 12 },
        { nodeId: "5", parentId: "1", role: { value: "main" }, name: { value: "Content" }, backendDOMNodeId: 13 },
        { nodeId: "6", parentId: "5", role: { value: "heading" }, name: { value: "Welcome" }, backendDOMNodeId: 14 },
        { nodeId: "7", parentId: "5", role: { value: "textbox" }, name: { value: "Search" }, backendDOMNodeId: 15 },
      ];

      const { snapshot } = buildAriaSnapshot(nodes);
      expect(snapshot).toContain('navigation "Main Nav"');
      expect(snapshot).toContain('link "Home"');
      expect(snapshot).toContain('link "About"');
      expect(snapshot).toContain('main "Content"');
      expect(snapshot).toContain('heading "Welcome"');
      expect(snapshot).toContain('textbox "Search"');
      // Verify indentation: links should be indented under navigation
      const lines = snapshot.split("\n");
      const navLine = lines.find(l => l.includes("navigation"));
      const linkLine = lines.find(l => l.includes('link "Home"'));
      expect(navLine).toBeDefined();
      expect(linkLine).toBeDefined();
      // Link should have more indentation than navigation
      const navIndent = navLine!.search(/\S/);
      const linkIndent = linkLine!.search(/\S/);
      expect(linkIndent).toBeGreaterThan(navIndent);
    });
  });

  describe("orphan handling", () => {
    it("should attach orphan nodes to root when parent is missing", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "3", parentId: "999", role: { value: "button" }, name: { value: "Orphan Button" }, backendDOMNodeId: 20 },
      ];

      const { snapshot } = buildAriaSnapshot(nodes);
      expect(snapshot).toContain('button "Orphan Button"');
    });
  });

  describe("presentation node skipping", () => {
    it("should skip presentational nodes and promote their children", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "2", parentId: "1", role: { value: "presentation" }, name: { value: "" } },
        { nodeId: "3", parentId: "2", role: { value: "button" }, name: { value: "Click Me" }, backendDOMNodeId: 30 },
        { nodeId: "4", parentId: "2", role: { value: "link" }, name: { value: "Go" }, backendDOMNodeId: 31 },
      ];

      const { snapshot } = buildAriaSnapshot(nodes);
      // Presentation node should not appear
      expect(snapshot).not.toContain("presentation");
      // Children should be promoted
      expect(snapshot).toContain('button "Click Me"');
      expect(snapshot).toContain('link "Go"');
    });

    it("should skip 'none' role nodes and promote children", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "2", parentId: "1", role: { value: "none" }, name: { value: "" } },
        { nodeId: "3", parentId: "2", role: { value: "heading" }, name: { value: "Title" }, backendDOMNodeId: 40 },
      ];

      const { snapshot } = buildAriaSnapshot(nodes);
      expect(snapshot).not.toContain("none");
      expect(snapshot).toContain('heading "Title"');
    });
  });

  describe("safety cap", () => {
    it("should truncate nodes exceeding SNAPSHOT_MAX_NODES", () => {
      const nodes: any[] = [
        { nodeId: "0", role: { value: "RootWebArea" }, name: { value: "Big Page" } },
      ];
      // Create 20000 child nodes
      for (let i = 1; i <= 20000; i++) {
        nodes.push({
          nodeId: String(i),
          parentId: "0",
          role: { value: "generic" },
          name: { value: `Item ${i}` },
        });
      }

      const { snapshot } = buildAriaSnapshot(nodes);
      // Count how many "Item" entries appear — should be capped
      const itemCount = (snapshot.match(/Item \d+/g) || []).length;
      expect(itemCount).toBeLessThanOrEqual(SNAPSHOT_MAX_NODES);
    });
  });

  describe("ref assignment", () => {
    it("should assign refs to interactive nodes with backendDOMNodeId", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "2", parentId: "1", role: { value: "button" }, name: { value: "Submit" }, backendDOMNodeId: 42 },
        { nodeId: "3", parentId: "1", role: { value: "link" }, name: { value: "Help" }, backendDOMNodeId: 43 },
      ];

      const { snapshot, ariaState } = buildAriaSnapshot(nodes);
      expect(snapshot).toContain("[ref=e1]");
      expect(snapshot).toContain("[ref=e2]");
      expect(ariaState.refMap.get("e1")).toBe(42);
      expect(ariaState.refMap.get("e2")).toBe(43);
    });

    it("should assign refs to landmark nodes with names", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "2", parentId: "1", role: { value: "navigation" }, name: { value: "Main" }, backendDOMNodeId: 50 },
        { nodeId: "3", parentId: "1", role: { value: "heading" }, name: { value: "Title" }, backendDOMNodeId: 51 },
      ];

      const { snapshot, ariaState } = buildAriaSnapshot(nodes);
      expect(snapshot).toContain("[ref=e1]");
      expect(snapshot).toContain("[ref=e2]");
      expect(ariaState.refMap.get("e1")).toBe(50);
      expect(ariaState.refMap.get("e2")).toBe(51);
    });

    it("should not assign refs to nodes without backendDOMNodeId", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "2", parentId: "1", role: { value: "button" }, name: { value: "No Backend" } },
      ];

      const { snapshot, ariaState } = buildAriaSnapshot(nodes);
      expect(snapshot).not.toContain("[ref=");
      expect(ariaState.refMap.size).toBe(0);
    });
  });

  describe("empty page", () => {
    it("should return '(empty page)' for empty nodes array", () => {
      const { snapshot } = buildAriaSnapshot([]);
      expect(snapshot).toBe("(empty page)");
    });

    it("should return '(empty page)' for only ignored nodes", () => {
      const { snapshot } = buildAriaSnapshot([
        { nodeId: "1", ignored: true, role: { value: "RootWebArea" }, name: { value: "" } },
      ]);
      expect(snapshot).toBe("(empty page)");
    });
  });

  describe("generic nodes", () => {
    it("should skip empty generic nodes without children", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "2", parentId: "1", role: { value: "generic" }, name: { value: "" } },
        { nodeId: "3", parentId: "1", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 60 },
      ];

      const { snapshot } = buildAriaSnapshot(nodes);
      expect(snapshot).toContain('button "OK"');
      // Generic empty node should not produce extra lines
      const lines = snapshot.split("\n").filter(l => l.trim());
      expect(lines.length).toBe(2); // RootWebArea + button
    });

    it("should render generic nodes with text content", () => {
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "2", parentId: "1", role: { value: "generic" }, name: { value: "Some text" } },
      ];

      const { snapshot } = buildAriaSnapshot(nodes);
      expect(snapshot).toContain('"Some text"');
    });
  });

  describe("name truncation", () => {
    it("should truncate names longer than 50 characters", () => {
      const longName = "A".repeat(60);
      const nodes = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" } },
        { nodeId: "2", parentId: "1", role: { value: "heading" }, name: { value: longName }, backendDOMNodeId: 70 },
      ];

      const { snapshot } = buildAriaSnapshot(nodes);
      expect(snapshot).toContain("...");
      expect(snapshot).not.toContain(longName);
    });
  });
});
