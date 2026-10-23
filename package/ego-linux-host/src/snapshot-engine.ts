// AX traversal is adapted from nosliwhtes/ego-lite PR #291, snapshot-ax.ts,
// commit 7bb1545912bf7e7bdf4239a321d36af0e68cb65c (MIT). Frame ownership,
// renderer-independent refs and snapshot scoping are implemented here.
import { randomUUID } from "node:crypto";

type CdpCall = (
  method: string,
  params?: any,
  sessionId?: string,
) => Promise<any>;

type AxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: unknown };
  backendDOMNodeId?: number;
  childIds?: string[];
  frameId?: string;
  properties?: Array<{ name: string; value: { value?: unknown } }>;
};

type Frame = {
  id: string;
  parent?: Frame;
  session: string;
  children: Frame[];
  nodes: AxNode[];
  owner?: number;
  viewport?: Rect;
};

type Rect = { left: number; top: number; right: number; bottom: number };
type Inspection = {
  visible: boolean;
  loc?: string;
  url?: string;
  clip: Rect;
  box: Rect;
  clientLeft: number;
  clientTop: number;
};

type SnapshotRef = {
  refId: number;
  backendNodeId: number;
  frameId?: string;
  frameProvenance: "page" | "frame";
  role: string;
  name: string;
  loc?: string;
};

type TreeNode = {
  role: string;
  name: string;
  backendNodeId?: number;
  frame: Frame;
  properties: AxNode["properties"];
  children: TreeNode[];
  loc?: string;
  url?: string;
  value?: string | number | boolean;
};

const interactiveRoles = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "scrollbar",
]);

const roles: Record<string, string> = {
  RootWebArea: "root",
  StaticText: "text",
  generic: "container",
  none: "container",
  presentation: "container",
  Iframe: "iframe",
  IframePresentational: "iframe",
  SvgRoot: "svg_root",
  Canvas: "canvas",
  listitem: "list_item",
  row: "table_row",
  cell: "table_cell",
  LayoutTable: "table",
  LayoutTableRow: "table_row",
  LayoutTableCell: "table_cell",
};

function fail(message: string, code = "EGO_SNAPSHOT_FAILED"): never {
  throw Object.assign(new Error(message), { error_code: code });
}

function intersect(a: Rect, b: Rect): Rect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

// Runs in the resolved node's realm. Identity is proved with DOM object equality,
// including hidden duplicate elements; a selector count alone is insufficient.
function inspectNode(this: any): Inspection {
  const element = this.nodeType === 1 ? this : this.parentElement;
  const doc = this.ownerDocument;
  const win = doc?.defaultView;
  const zero = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!element || !win)
    return {
      visible: false,
      clip: zero,
      box: zero,
      clientLeft: 0,
      clientTop: 0,
    };
  let box = element.getBoundingClientRect();
  if (this.nodeType === 3 && doc.createRange) {
    const range = doc.createRange();
    range.selectNodeContents(this);
    box = range.getBoundingClientRect();
    range.detach();
  }
  let clip = {
    left: Math.max(0, box.left),
    top: Math.max(0, box.top),
    right: Math.min(win.innerWidth, box.right),
    bottom: Math.min(win.innerHeight, box.bottom),
  };
  let hidden = false;
  for (
    let parent = element;
    parent;
    parent = parent.parentElement ?? parent.getRootNode?.()?.host
  ) {
    const style = win.getComputedStyle(parent);
    if (
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.display === "none"
    )
      hidden = true;
    if (parent === element) continue;
    const rect = parent.getBoundingClientRect();
    if (
      ["hidden", "clip", "scroll", "auto", "overlay"].includes(style.overflowX)
    ) {
      clip.left = Math.max(clip.left, rect.left + (parent.clientLeft ?? 0));
      clip.right = Math.min(
        clip.right,
        rect.left +
          (parent.clientLeft ?? 0) +
          (parent.clientWidth ?? rect.width),
      );
    }
    if (
      ["hidden", "clip", "scroll", "auto", "overlay"].includes(style.overflowY)
    ) {
      clip.top = Math.max(clip.top, rect.top + (parent.clientTop ?? 0));
      clip.bottom = Math.min(
        clip.bottom,
        rect.top +
          (parent.clientTop ?? 0) +
          (parent.clientHeight ?? rect.height),
      );
    }
  }
  let loc: string | undefined;
  let url: string | undefined;
  if (this.nodeType === 1) {
    if (this.id) {
      const selector = "#" + CSS.escape(this.id);
      const matches = doc.querySelectorAll(selector);
      if (matches.length === 1 && matches[0] === this) loc = "css:" + selector;
    }
    url = this.getAttribute("href") ?? undefined;
    if (!loc && url && this.tagName?.toLowerCase() === "a") {
      try {
        const destination = new URL(this.href, doc.baseURI);
        const path =
          destination.pathname + destination.search + destination.hash;
        const matches = [...doc.querySelectorAll("a[href]")].filter(
          (node: any) => {
            try {
              const target = new URL(node.href, doc.baseURI);
              return (
                target.pathname + target.search + target.hash === path ||
                target.href === path
              );
            } catch {
              return false;
            }
          },
        );
        if (matches.length === 1 && matches[0] === this) loc = "href:" + path;
      } catch {
        /* Invalid URLs have no stable href locator. */
      }
    }
  }
  return {
    visible: !hidden && clip.right > clip.left && clip.bottom > clip.top,
    loc,
    url,
    clip,
    box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    clientLeft: element.clientLeft ?? 0,
    clientTop: element.clientTop ?? 0,
  };
}

function countLocators(this: any, locators: string[]): number[] {
  const doc = this.nodeType === 9 ? this : this.ownerDocument;
  const roots: any[] = doc ? [doc] : [];
  for (const root of roots) {
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot))
        roots.push(element.shadowRoot);
    }
  }
  const query = (selector: string): any[] =>
    roots.flatMap((root) => [...root.querySelectorAll(selector)]);
  return locators.map((locator) => {
    if (!doc) return -1;
    if (locator.startsWith("css:")) return query(locator.slice(4)).length;
    if (locator.startsWith("href:"))
      return query("a[href]").filter((node: any) => {
        try {
          const target = new URL(node.href, doc.baseURI);
          return (
            target.pathname + target.search + target.hash ===
              locator.slice(5) || target.href === locator.slice(5)
          );
        } catch {
          return false;
        }
      }).length;
    return -1;
  });
}

/** Task-bound Chromium AX snapshot. Never selects, focuses or navigates a tab. */
export class LinuxSnapshot {
  constructor(
    private cdp: CdpCall,
    private rootSessionId: string,
  ) {}

  async snapshot(
    opts: any = {},
  ): Promise<{ content: string; refs: SnapshotRef[] }> {
    if (!opts || typeof opts !== "object" || Array.isArray(opts))
      fail("Snapshot options must be an object", "EGO_INVALID_ARGUMENT");
    const scope = opts.scope ?? "full_page";
    if (!["full_page", "subtree", "only_within_viewport"].includes(scope))
      fail("Invalid snapshot scope", "EGO_INVALID_ARGUMENT");
    if (
      scope === "subtree" &&
      (!Number.isSafeInteger(opts.root) || opts.root <= 0)
    )
      fail(
        "Subtree snapshot requires a positive backend node root",
        "EGO_INVALID_ARGUMENT",
      );
    if (scope !== "subtree" && opts.root !== undefined)
      fail("root requires subtree scope", "EGO_INVALID_ARGUMENT");
    if (
      opts.rootFrameId !== undefined &&
      (scope !== "subtree" ||
        typeof opts.rootFrameId !== "string" ||
        !opts.rootFrameId)
    )
      fail(
        "rootFrameId requires subtree scope and a non-empty frame ID",
        "EGO_INVALID_ARGUMENT",
      );
    if (
      opts.maxResultLength !== undefined &&
      (!Number.isSafeInteger(opts.maxResultLength) || opts.maxResultLength < 0)
    )
      fail(
        "maxResultLength must be a non-negative integer",
        "EGO_INVALID_ARGUMENT",
      );
    for (const key of [
      "interactiveOnly",
      "includeActionMarks",
      "includeStableLocator",
    ]) {
      if (opts[key] !== undefined && typeof opts[key] !== "boolean")
        fail(`${key} must be a boolean`, "EGO_INVALID_ARGUMENT");
    }
    const attached: string[] = [];
    const frames = new Map<string, Frame>();
    const objectGroup = `ego-snapshot-${randomUUID()}`;
    const objectSessions = new Set<string>();
    const inspected = new Map<string, Inspection>();
    const inspect = async (
      frame: Frame,
      backendNodeId: number,
    ): Promise<Inspection> => {
      const key = `${frame.session}:${backendNodeId}`;
      if (inspected.has(key)) return inspected.get(key)!;
      objectSessions.add(frame.session);
      const { object } = await this.cdp(
        "DOM.resolveNode",
        { backendNodeId, objectGroup },
        frame.session,
      );
      if (!object?.objectId)
        fail("Snapshot node is no longer available; take a new snapshot");
      const { result, exceptionDetails } = await this.cdp(
        "Runtime.callFunctionOn",
        {
          objectId: object.objectId,
          functionDeclaration: inspectNode.toString(),
          returnByValue: true,
        },
        frame.session,
      );
      if (exceptionDetails || !result?.value)
        fail("Snapshot node inspection failed; take a new snapshot");
      const value = result.value as Inspection;
      inspected.set(key, value);
      return value;
    };
    try {
      const response = await this.cdp(
        "Page.getFrameTree",
        {},
        this.rootSessionId,
      );
      const add = (tree: any, parent?: Frame): Frame => {
        const id = tree?.frame?.id;
        if (!id) fail("Chromium returned an invalid frame tree");
        const existing = frames.get(id);
        if (existing) return existing;
        const frame: Frame = {
          id,
          parent,
          session: parent?.session ?? this.rootSessionId,
          children: [],
          nodes: [],
        };
        frames.set(id, frame);
        frame.children = (tree.childFrames ?? []).map((child: any) =>
          add(child, frame),
        );
        return frame;
      };
      const main = add(response.frameTree);
      for (const frame of frames.values()) {
        frame.session = frame.parent?.session ?? this.rootSessionId;
        if (frame.parent) {
          const owner = await this.cdp(
            "DOM.getFrameOwner",
            { frameId: frame.id },
            frame.parent.session,
          );
          if (!owner.backendNodeId)
            fail(`Frame owner is unavailable: ${frame.id}`);
          if (frame.owner && frame.owner !== owner.backendNodeId)
            fail(`Frame owner changed during snapshot: ${frame.id}`);
          frame.owner = owner.backendNodeId;
        }
        await this.cdp("Accessibility.enable", {}, frame.session);
        try {
          frame.nodes =
            (
              await this.cdp(
                "Accessibility.getFullAXTree",
                { frameId: frame.id },
                frame.session,
              )
            ).nodes ?? [];
          if (frame.nodes[0]?.frameId && frame.nodes[0].frameId !== frame.id)
            throw new Error("Frame belongs to another renderer");
        } catch (error) {
          if (!frame.parent) throw error;
          const targets: any[] =
            (await this.cdp("Target.getTargets", {}, this.rootSessionId))
              .targetInfos ?? [];
          if (
            !(targets ?? []).some(
              (target) =>
                target.type === "iframe" && target.targetId === frame.id,
            )
          )
            throw error;
          const { sessionId } = await this.cdp(
            "Target.attachToTarget",
            { targetId: frame.id, flatten: true },
            this.rootSessionId,
          );
          if (!sessionId) fail(`Cannot attach to frame: ${frame.id}`);
          attached.push(sessionId);
          frame.session = sessionId;
          await this.cdp("Accessibility.enable", {}, sessionId);
          frame.nodes =
            (
              await this.cdp(
                "Accessibility.getFullAXTree",
                { frameId: frame.id },
                sessionId,
              )
            ).nodes ?? [];
          const subtree = await this.cdp("Page.getFrameTree", {}, sessionId);
          for (const child of subtree.frameTree?.childFrames ?? []) {
            const nested = add(child, frame);
            if (!frame.children.includes(nested)) frame.children.push(nested);
          }
        }
        if (!frame.nodes.length)
          fail(`Accessibility tree is unavailable for frame: ${frame.id}`);
        for (const node of frame.nodes) {
          if (
            !["Iframe", "IframePresentational"].includes(
              node.role?.value ?? "",
            ) ||
            !node.backendDOMNodeId ||
            frame.children.some(
              (child) => child.owner === node.backendDOMNodeId,
            )
          )
            continue;
          // Remote renderers are not always represented in the parent session's
          // frame tree. Chromium's DOM frame-owner metadata proves that edge.
          const { node: owner } = await this.cdp(
            "DOM.describeNode",
            { backendNodeId: node.backendDOMNodeId, depth: 0 },
            frame.session,
          );
          if (typeof owner?.frameId !== "string" || owner.frameId === frame.id)
            continue;
          const child = add({ frame: { id: owner.frameId } }, frame);
          if (child.parent !== frame)
            fail("Frame topology changed during snapshot");
          child.owner ??= node.backendDOMNodeId;
          if (!frame.children.includes(child)) frame.children.push(child);
        }
      }
      for (const frame of frames.values()) {
        if (
          frame.parent &&
          !frame.parent.nodes.some(
            (node) => node.backendDOMNodeId === frame.owner,
          )
        )
          fail(`Frame AX boundary is unavailable: ${frame.id}`);
      }

      let selected: { frame: Frame; node: AxNode } | undefined;
      if (scope === "subtree") {
        const matches = [...frames.values()].flatMap((frame) =>
          frame.nodes
            .filter(
              (node) =>
                node.backendDOMNodeId === opts.root &&
                (opts.rootFrameId === undefined ||
                  opts.rootFrameId === frame.id),
            )
            .map((node) => ({ frame, node })),
        );
        if (!matches.length)
          fail("Snapshot root is not available in this document");
        if (matches.length > 1)
          fail(
            `Snapshot root is ambiguous across frames (${matches.map(({ frame, node }) => `${frame.id}:${node.role?.value}`).join(", ")})`,
          );
        selected = matches[0];
      }
      if (scope === "only_within_viewport") {
        for (const frame of frames.values()) {
          if (!frame.parent || !frame.owner) continue;
          const owner = await inspect(frame.parent, frame.owner);
          const clip = frame.parent.viewport
            ? intersect(owner.clip, frame.parent.viewport)
            : owner.clip;
          const left = owner.box.left + owner.clientLeft;
          const top = owner.box.top + owner.clientTop;
          frame.viewport = owner.visible
            ? {
                left: clip.left - left,
                top: clip.top - top,
                right: clip.right - left,
                bottom: clip.bottom - top,
              }
            : { left: 0, top: 0, right: 0, bottom: 0 };
        }
      }
      const buildFrame = async (
        frame: Frame,
        root?: AxNode,
      ): Promise<TreeNode[]> => {
        if (
          frame.viewport &&
          (frame.viewport.right <= frame.viewport.left ||
            frame.viewport.bottom <= frame.viewport.top)
        )
          return [];
        const nodes = new Map(frame.nodes.map((node) => [node.nodeId, node]));
        const seen = new Set<string>();
        const visit = async (node: AxNode | undefined): Promise<TreeNode[]> => {
          if (
            !node ||
            seen.has(node.nodeId) ||
            node.role?.value === "InlineTextBox"
          )
            return [];
          if (
            node.role?.value === "RootWebArea" &&
            node.frameId &&
            node.frameId !== frame.id
          )
            return [];
          seen.add(node.nodeId);
          const ownedFrames = frame.children.filter(
            (child) => child.owner === node.backendDOMNodeId,
          );
          const role = ownedFrames.length
            ? "iframe"
            : (roles[node.role?.value ?? ""] ??
              node.role?.value ??
              "container");
          const name = node.name?.value ?? "";
          const metadata =
            node.backendDOMNodeId &&
            role !== "root" &&
            !node.ignored &&
            (scope === "only_within_viewport" || opts.includeStableLocator)
              ? await inspect(frame, node.backendDOMNodeId)
              : undefined;
          let visible = metadata?.visible ?? true;
          if (metadata && frame.viewport) {
            const clip = intersect(metadata.clip, frame.viewport);
            visible &&= clip.right > clip.left && clip.bottom > clip.top;
          }
          if (scope === "only_within_viewport" && role === "iframe" && !visible)
            return [];
          const children: TreeNode[] = [];
          for (const child of node.childIds ?? [])
            children.push(...(await visit(nodes.get(child))));
          for (const child of ownedFrames)
            children.push(...(await buildFrame(child)));
          if (node.ignored && role !== "iframe") return children;
          if (scope === "only_within_viewport" && !visible) return children;
          const actionable =
            interactiveRoles.has(role) ||
            node.properties?.some(
              (property) =>
                property.name === "focusable" && property.value.value === true,
            );
          if (
            opts.interactiveOnly &&
            !actionable &&
            role !== "iframe" &&
            role !== "root"
          )
            return children;
          if (role === "text" && !name.replace(/[\s\p{Cf}]/gu, ""))
            return children;
          if (
            role === "container" &&
            !name &&
            !actionable &&
            children.length <= 1
          )
            return children;
          return [
            {
              role,
              name,
              frame,
              properties: node.properties,
              ...(!node.properties?.some(
                (property) =>
                  property.name === "protected" &&
                  property.value.value === true,
              ) &&
              ["string", "number", "boolean"].includes(typeof node.value?.value)
                ? { value: node.value!.value as string | number | boolean }
                : {}),
              children,
              ...(node.backendDOMNodeId &&
              role !== "root" &&
              role !== "text" &&
              (role !== "container" || name || actionable)
                ? { backendNodeId: node.backendDOMNodeId }
                : {}),
              ...(opts.includeStableLocator && metadata?.loc
                ? { loc: metadata.loc }
                : {}),
              ...((metadata?.url ??
              node.properties?.find((property) => property.name === "url")
                ?.value.value)
                ? {
                    url: String(
                      metadata?.url ??
                        node.properties?.find(
                          (property) => property.name === "url",
                        )?.value.value,
                    ),
                  }
                : {}),
            },
          ];
        };
        return visit(
          root ??
            frame.nodes.find(
              (node) =>
                node.role?.value === "RootWebArea" && node.frameId === frame.id,
            ) ??
            frame.nodes[0],
        );
      };
      const tree = selected
        ? await buildFrame(selected.frame, selected.node)
        : await buildFrame(main);
      if (opts.includeStableLocator) {
        const advertised: TreeNode[] = [];
        const collect = (node: TreeNode) => {
          if (node.loc) advertised.push(node);
          node.children.forEach(collect);
        };
        tree.forEach(collect);
        const locators = [...new Set(advertised.map((node) => node.loc!))];
        if (locators.length) {
          const totals = locators.map(() => 0);
          for (const frame of frames.values()) {
            const document = frame.nodes.find(
              (node) =>
                node.role?.value === "RootWebArea" &&
                (!node.frameId || node.frameId === frame.id),
            );
            if (!document?.backendDOMNodeId) {
              totals.fill(-1);
              break;
            }
            objectSessions.add(frame.session);
            const { object } = await this.cdp(
              "DOM.resolveNode",
              { backendNodeId: document.backendDOMNodeId, objectGroup },
              frame.session,
            );
            if (!object?.objectId) {
              totals.fill(-1);
              break;
            }
            const { result, exceptionDetails } = await this.cdp(
              "Runtime.callFunctionOn",
              {
                objectId: object.objectId,
                functionDeclaration: countLocators.toString(),
                arguments: [{ value: locators }],
                returnByValue: true,
              },
              frame.session,
            );
            const counts = result?.value;
            if (
              exceptionDetails ||
              !Array.isArray(counts) ||
              counts.length !== locators.length ||
              counts.some(
                (count: unknown) =>
                  !Number.isSafeInteger(count) || Number(count) < 0,
              )
            ) {
              totals.fill(-1);
              break;
            }
            counts.forEach((count: number, index: number) => {
              totals[index] += count;
            });
          }
          const valid = new Set(
            locators.filter((_, index) => totals[index] === 1),
          );
          for (const node of advertised)
            if (!valid.has(node.loc!)) delete node.loc;
        }
      }
      const refs: SnapshotRef[] = [];
      const lines: string[] = [];
      let length = 0;
      const render = (node: TreeNode, depth: number): boolean => {
        const metadata: string[] = [];
        const ref: SnapshotRef | undefined = node.backendNodeId
          ? {
              refId: refs.length + 1,
              backendNodeId: node.backendNodeId,
              role: node.role,
              name: node.name,
              ...(node.frame !== main ? { frameId: node.frame.id } : {}),
              frameProvenance: node.frame === main ? "page" : "frame",
              ...(node.loc ? { loc: node.loc } : {}),
            }
          : undefined;
        if (ref) metadata.push(`ref=${ref.refId}`);
        if (ref?.loc) metadata.push(`loc=${ref.loc}`);
        if (node.url) metadata.push(`url=${node.url}`);
        if (node.value !== undefined)
          metadata.push(`value=${JSON.stringify(node.value)}`);
        if (opts.includeActionMarks) {
          for (const { name, value } of node.properties ?? []) {
            if (
              ["disabled", "focused", "readonly", "required"].includes(name) &&
              value.value === true
            )
              metadata.push(name);
            if (["checked", "selected", "expanded", "pressed"].includes(name))
              metadata.push(`${name}=${String(value.value)}`);
          }
        }
        const line = `${"  ".repeat(depth)}${node.role}${node.name ? ` ${JSON.stringify(node.name)}` : ""}${metadata.length ? ` [${metadata.join(", ")}]` : ""}`;
        const nextLength = length + line.length + (lines.length ? 1 : 0);
        if (opts.maxResultLength && nextLength > opts.maxResultLength)
          return false;
        length = nextLength;
        lines.push(line);
        if (ref) refs.push(ref);
        return node.children.every((child) => render(child, depth + 1));
      };
      tree.every((node) => render(node, 0));
      return { content: lines.join("\n"), refs };
    } catch (error: any) {
      if (error?.error_code) throw error;
      return fail(error?.message ?? String(error));
    } finally {
      for (const sessionId of objectSessions) {
        await this.cdp(
          "Runtime.releaseObjectGroup",
          { objectGroup },
          sessionId,
        ).catch(() => {});
      }
      for (const sessionId of attached.reverse()) {
        await this.cdp(
          "Target.detachFromTarget",
          { sessionId },
          this.rootSessionId,
        ).catch(() => {});
      }
    }
  }
}
