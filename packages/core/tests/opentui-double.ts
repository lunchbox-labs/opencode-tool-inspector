import { EventEmitter } from "node:events";

interface Options {
  content?: string | StyledText;
  height?: number;
  fg?: unknown;
}

// Flow tests need the component tree and events; the native TUI check covers rendering.
export class BoxRenderable extends EventEmitter {
  readonly children: BoxRenderable[] = [];
  readonly config: Options;
  isDestroyed = false;
  // Tests assign laid-out heights and call onSizeChange where OpenTUI's layout would.
  height: number;
  onSizeChange?: () => void;
  constructor(_renderer: unknown, config: Options) {
    super();
    this.config = config;
    this.height = config.height ?? 0;
  }
  add(child: BoxRenderable) {
    this.children.push(child);
  }
  getChildren() {
    return this.children;
  }
  destroyRecursively() {
    for (const child of this.children) {
      child.destroyRecursively();
    }
    this.isDestroyed = true;
    this.emit("destroyed");
    this.removeAllListeners();
  }
}

export class StyledText {
  readonly chunks: { text: string; fg?: unknown }[];
  constructor(chunks: { text: string; fg?: unknown }[]) {
    this.chunks = chunks;
  }
}

export class TextRenderable extends BoxRenderable {
  get plainText(): string {
    const content = this.config.content;
    return content instanceof StyledText
      ? content.chunks.map((chunk) => chunk.text).join("")
      : (content ?? "");
  }
}

export class ScrollBoxRenderable extends BoxRenderable {
  focus() {}
  scrollBy() {}
}

export const RenderableEvents = { DESTROYED: "destroyed" };
export const TextAttributes = { BOLD: 1 };
