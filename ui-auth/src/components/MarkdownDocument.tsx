type Block =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

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
      blocks.push({ type: "h1", text: line.slice(2).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().slice(2).trim());
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || current.startsWith("# ") || current.startsWith("## ") || current.startsWith("- ")) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  return blocks;
}

export function MarkdownDocument({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === "h1") {
          return (
            <h1 key={index} className="text-xl font-semibold text-white">
              {block.text}
            </h1>
          );
        }

        if (block.type === "h2") {
          return (
            <h2 key={index} className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              {block.text}
            </h2>
          );
        }

        if (block.type === "ul") {
          return (
            <ul key={index} className="space-y-2">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2 text-sm text-slate-200 leading-relaxed">
                  <span className="text-[#6DD8F0] mt-0.5">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="text-sm text-slate-200 leading-relaxed">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}