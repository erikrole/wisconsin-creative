"use client";

import {
  CheckIcon,
  CopyIcon,
  InfoIcon,
  LightbulbIcon,
  LinkIcon,
  MessageSquareWarningIcon,
  OctagonAlertIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import type { ReactNode } from "react";
import { Children, isValidElement, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnimatePresence, motion } from "motion/react";
import { headingId, markdownHeadingId, markdownHeadingText } from "@/lib/guide-content";
import { parseEmbed } from "@/lib/media-embed";
import { type CalloutType, parseCalloutType, remarkCallouts } from "@/lib/remark-callouts";
import { cn } from "@/lib/utils";

const CALLOUT_META: Record<CalloutType, { label: string; icon: LucideIcon }> = {
  note: { label: "Note", icon: InfoIcon },
  tip: { label: "Tip", icon: LightbulbIcon },
  important: { label: "Important", icon: MessageSquareWarningIcon },
  warning: { label: "Warning", icon: TriangleAlertIcon },
  caution: { label: "Caution", icon: OctagonAlertIcon },
};

type Props = {
  markdown: string;
};

function reactNodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const type = typeof node.type === "string" ? node.type : "";
    const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    if (type === "tr") return `${children.map(reactNodeText).join("\t")}\n`;
    if (type === "th" || type === "td") return reactNodeText(node.props.children).trim();
    return reactNodeText(node.props.children);
  }
  return "";
}

function HeadingLink({
  id,
  children,
  level,
}: {
  id: string;
  children: ReactNode;
  level: 1 | 2 | 3;
}) {
  const Heading = `h${level}` as const;
  const className = cn(
    "guide-markdown-heading group scroll-m-24",
    level === 1 && "guide-markdown-h1 first:mt-0",
    level === 2 && "guide-markdown-h2",
    level === 3 && "guide-markdown-h3",
  );

  return (
    <Heading id={id} className={className}>
      <span className="guide-heading-content">
        {children}
        <a
          href={`#${id}`}
          aria-label={`Link to ${reactNodeText(children)}`}
          className="guide-heading-anchor"
        >
          <LinkIcon className="size-4" />
        </a>
      </span>
    </Heading>
  );
}

function CopyReferenceButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text.trimEnd());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      className="guide-copy-button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy reference"}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={copied ? "copied" : "copy"}
          initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          className="inline-flex items-center justify-center"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </motion.span>
      </AnimatePresence>
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Callout({ type, children }: { type: CalloutType; children: ReactNode }) {
  const { label, icon: Icon } = CALLOUT_META[type];
  return (
    <div className={`guide-alert guide-alert-${type}`} role="note">
      <div className="guide-alert-header">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="guide-alert-body">{children}</div>
    </div>
  );
}

function SafeEmbed({ url }: { url: string }) {
  const embed = parseEmbed(url);

  if (!embed) {
    return (
      <a
        href={url}
        className="font-semibold text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground"
        rel="noreferrer"
        target="_blank"
      >
        {url}
      </a>
    );
  }

  return (
    <span className="guide-embed">
      <span className="guide-embed-frame">
        <iframe
          src={embed.src}
          title={embed.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </span>
    </span>
  );
}

function preLanguage(children: ReactNode): string | undefined {
  const codeChild = Children.toArray(children).find(isValidElement) as
    | React.ReactElement<{ className?: string }>
    | undefined;
  return codeChild?.props?.className?.match(/language-([\w-]+)/)?.[1];
}

export function MarkdownReader({ markdown }: Props) {
  const headingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of markdown.split("\n")) {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (!match) continue;
      const text = markdownHeadingText(match[2] ?? "");
      const base = headingId(text) || "section";
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    return counts;
  }, [markdown]);

  function nextHeadingId(children: ReactNode, line: number | undefined) {
    return markdownHeadingId(reactNodeText(children), line, headingCounts);
  }

  // Memoized so the components map keeps a stable identity across re-renders
  // (e.g. scroll-driven activeHeadingId updates in the parent GuideReader).
  // react-markdown treats a new `components` object as a signal to re-render
  // its whole tree, so recreating this literal every render was forcing a
  // full markdown re-render on every scroll tick.
  const components = useMemo<Components>(
    () => ({
      h1: ({ children, node }) => {
        const id = nextHeadingId(children, node?.position?.start.line);
        return <HeadingLink id={id} level={1}>{children}</HeadingLink>;
      },
      h2: ({ children, node }) => {
        const id = nextHeadingId(children, node?.position?.start.line);
        return <HeadingLink id={id} level={2}>{children}</HeadingLink>;
      },
      h3: ({ children, node }) => {
        const id = nextHeadingId(children, node?.position?.start.line);
        return <HeadingLink id={id} level={3}>{children}</HeadingLink>;
      },
      p: ({ children }) => (
        <p className="guide-markdown-paragraph">{children}</p>
      ),
      ul: ({ children }) => <ul className="guide-markdown-list list-disc">{children}</ul>,
      ol: ({ children }) => <ol className="guide-markdown-list list-decimal">{children}</ol>,
      li: ({ children }) => <li className="guide-markdown-list-item">{children}</li>,
      a: ({ children, href }) => (
        <a
          href={href}
          className="font-semibold text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground"
          rel="noreferrer"
          target={href?.startsWith("http") ? "_blank" : undefined}
        >
          {children}
        </a>
      ),
      code: ({ children, className }) => (
        <code
          className={cn(
            "guide-markdown-inline-code",
            className,
          )}
        >
          {children}
        </code>
      ),
      pre: ({ children }) => {
        const language = preLanguage(children);
        if (language === "embed" || language === "video") {
          return <SafeEmbed url={reactNodeText(children).trim()} />;
        }
        const text = reactNodeText(children);
        return (
          <div className="guide-code-block-wrap">
            <CopyReferenceButton text={text} />
            <pre className="guide-markdown-code-block">{children}</pre>
          </div>
        );
      },
      blockquote: ({ children, className }) => {
        const calloutType = parseCalloutType(className);
        if (calloutType) {
          return <Callout type={calloutType}>{children}</Callout>;
        }
        return <blockquote className="guide-markdown-quote">{children}</blockquote>;
      },
      table: ({ children }) => (
        <div className="guide-table-block">
          <CopyReferenceButton text={reactNodeText(children)} />
          <div className="guide-markdown-table-wrap">
            <table className="guide-markdown-table">{children}</table>
          </div>
        </div>
      ),
      th: ({ children }) => (
        <th>{children}</th>
      ),
      td: ({ children }) => (
        <td>{children}</td>
      ),
      img: ({ src, alt }) => {
        if (!src || typeof src !== "string") return null;
        const caption = typeof alt === "string" ? alt.trim() : "";
        return (
          <span className="guide-markdown-media">
            <span className="guide-markdown-image-frame">
              {/* Markdown images can have arbitrary source dimensions; native img preserves that ratio. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- source dimensions are not known until the Markdown image loads. */}
              <img
                src={src}
                alt={caption}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full"
              />
            </span>
            {caption && (
              <span className="guide-markdown-caption">{caption}</span>
            )}
          </span>
        );
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [headingCounts],
  );

  return (
    <div className="guide-markdown min-w-0 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        skipHtml
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
