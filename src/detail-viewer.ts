import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { TextLine, TextTone } from "./schema-text.ts";
import type { ToolDetail } from "./tool-detail.ts";

// The host dialog starts a quarter down the screen; its padding plus this view's
// title, footer, gaps and a margin clear of the status bar take the remaining rows.
const chromeRows = 9;

type DialogElement = ReturnType<TuiPluginApi["ui"]["DialogAlert"]>;

/** Renders a tool's detail sections in a keyboard-scrollable box inside the host's dialog frame. */
export async function createDetailViewer(api: TuiPluginApi) {
  // OpenCode supplies its shared runtime; importing this entrypoint stays Node-safe.
  const {
    BoxRenderable,
    RenderableEvents,
    ScrollBoxRenderable,
    StyledText,
    TextAttributes,
    TextRenderable,
  } = await import("@opentui/core");

  return (detail: ToolDetail): DialogElement => {
    const { renderer } = api;
    const theme = api.theme.current;
    const toneColours: Record<TextTone, typeof theme.text> = {
      plain: theme.text,
      name: theme.text,
      muted: theme.textMuted,
    };
    const styled = (lines: readonly TextLine[]) =>
      new StyledText(
        lines.flatMap((line, index) => [
          ...(index === 0 ? [] : [{ __isChunk: true as const, text: "\n" }]),
          ...line.map((segment) => ({
            __isChunk: true as const,
            text: segment.text,
            fg: toneColours[segment.tone],
            ...(segment.tone === "name"
              ? { attributes: TextAttributes.BOLD }
              : {}),
          })),
        ]),
      );
    const rows = () =>
      Math.max(
        1,
        renderer.height - Math.floor(renderer.height / 4) - chromeRows,
      );
    const view = new BoxRenderable(renderer, {
      flexDirection: "column",
      paddingX: 2,
      paddingBottom: 1,
      gap: 1,
    });
    view.add(
      new TextRenderable(renderer, {
        content: detail.title,
        fg: theme.text,
        attributes: TextAttributes.BOLD,
        selectable: false,
      }),
    );
    const body = new BoxRenderable(renderer, {
      flexDirection: "column",
      gap: 1,
    });
    if (detail.subtitle !== undefined) {
      body.add(
        new TextRenderable(renderer, {
          content: detail.subtitle,
          fg: theme.textMuted,
          wrapMode: "word",
        }),
      );
    }
    for (const section of detail.sections) {
      const block = new BoxRenderable(renderer, { flexDirection: "column" });
      block.add(
        new TextRenderable(renderer, {
          content: section.heading,
          fg: theme.accent,
          attributes: TextAttributes.BOLD,
          selectable: false,
        }),
      );
      block.add(
        new TextRenderable(renderer, {
          content: styled(section.lines),
          fg: theme.text,
          wrapMode: "word",
        }),
      );
      body.add(block);
    }
    const unwrappedRows = detail.sections.reduce(
      (total, section) => total + section.lines.length + 2,
      detail.subtitle === undefined ? 0 : 2,
    );
    const scroll = new ScrollBoxRenderable(renderer, {
      height: Math.min(rows(), unwrappedRows),
      flexShrink: 0,
      verticalScrollbarOptions: {
        paddingLeft: 1,
        trackOptions: {
          backgroundColor: theme.backgroundElement,
          foregroundColor: theme.border,
        },
      },
    });
    // Short details keep a compact dialog; long ones scroll within the terminal.
    const fit = () => {
      if (!scroll.isDestroyed) {
        scroll.height = Math.max(1, Math.min(rows(), body.height));
      }
    };
    body.onSizeChange = fit;
    scroll.add(body);
    view.add(scroll);
    view.add(
      new TextRenderable(renderer, {
        content: "↑/↓ scroll · pgup/pgdn page · home/end · esc back",
        fg: theme.textMuted,
        selectable: false,
      }),
    );
    renderer.on("resize", fit);
    // The session's global paging keys close dialogs; a later layer on the
    // focused box takes precedence, as the host's own DialogSelect does.
    const unbind = api.keymap.registerLayer({
      target: scroll,
      targetMode: "focus",
      bindings: [
        { key: "pageup", cmd: () => scroll.scrollBy(-1 / 2, "viewport") },
        { key: "pagedown", cmd: () => scroll.scrollBy(1 / 2, "viewport") },
        { key: "home", cmd: () => scroll.scrollBy(-1, "content") },
        { key: "end", cmd: () => scroll.scrollBy(1, "content") },
      ],
    });
    // Escape first restores the host's previous input focus, as after native DialogSelect.
    const focus = setTimeout(() => {
      if (!scroll.isDestroyed && !api.lifecycle.signal.aborted) {
        scroll.focus();
      }
    }, 1);
    const dispose = () => view.destroyRecursively();
    api.lifecycle.signal.addEventListener("abort", dispose, { once: true });
    view.on(RenderableEvents.DESTROYED, () => {
      clearTimeout(focus);
      renderer.off("resize", fit);
      unbind();
      api.lifecycle.signal.removeEventListener("abort", dispose);
    });
    // OpenTUI accepts Renderable children; Solid's shared JSX type still names DOM nodes.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- OpenTUI's reconciler inserts Renderable instances directly.
    return view as unknown as DialogElement;
  };
}
