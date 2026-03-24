import React from "react";

type Block =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

function stripMarkdownInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push({ type: "h1", text: stripMarkdownInline(line.slice(2).trim()) });
      index += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: stripMarkdownInline(line.slice(3).trim()) });
      index += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: stripMarkdownInline(line.slice(4).trim()) });
      index += 1;
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (!(current.startsWith("- ") || current.startsWith("* "))) break;
        items.push(stripMarkdownInline(current.slice(2).trim()));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (!/^\d+\.\s/.test(current)) break;
        items.push(stripMarkdownInline(current.replace(/^\d+\.\s/, "")));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (
        !current ||
        current.startsWith("# ") ||
        current.startsWith("## ") ||
        current.startsWith("### ") ||
        current.startsWith("- ") ||
        current.startsWith("* ") ||
        /^\d+\.\s/.test(current)
      ) {
        break;
      }
      paragraph.push(stripMarkdownInline(current));
      index += 1;
    }

    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  return blocks;
}

export function markdownToPlainText(markdown: string): string {
  const blocks = parseMarkdown(markdown);
  return blocks
    .flatMap((block) => {
      if (block.type === "ul" || block.type === "ol") return block.items;
      return [block.text];
    })
    .map((text) => text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[0.92em] text-[#b9f4ff]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

export function MarkdownDocument({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === "h1") {
          return (
            <h1 key={index} className="text-xl font-semibold text-white">
              {renderInline(block.text)}
            </h1>
          );
        }

        if (block.type === "h2") {
          return (
            <h2
              key={index}
              className="text-sm font-semibold uppercase tracking-wider text-slate-300"
            >
              {renderInline(block.text)}
            </h2>
          );
        }

        if (block.type === "h3") {
          return (
            <h3 key={index} className="text-sm font-semibold text-slate-200">
              {renderInline(block.text)}
            </h3>
          );
        }

        if (block.type === "ul") {
          return (
            <ul key={index} className="space-y-2">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2 text-sm text-slate-200 leading-relaxed">
                  <span className="mt-0.5 text-[#6DD8F0]">•</span>
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol key={index} className="space-y-2">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-3 text-sm text-slate-200 leading-relaxed">
                  <span className="w-5 flex-shrink-0 text-right font-medium text-[#6DD8F0]">
                    {itemIndex + 1}.
                  </span>
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={index} className="text-sm leading-relaxed text-slate-200">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
