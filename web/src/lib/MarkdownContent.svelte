<script>
  export let source = '';

  function escapeHtml(value) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function inlineMarkdown(value) {
    let html = escapeHtml(value);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
    return html;
  }

  function renderMarkdown(markdown) {
    const lines = markdown.replaceAll('\r\n', '\n').split('\n');
    const output = [];
    let paragraph = [];
    let list = null;
    let code = null;

    function flushParagraph() {
      if (paragraph.length) {
        output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
        paragraph = [];
      }
    }

    function flushList() {
      if (!list) return;
      output.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
      list = null;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.startsWith('```')) {
        flushParagraph();
        flushList();
        if (code) {
          output.push(`<pre><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`);
          code = null;
        } else {
          code = { lines: [] };
        }
        continue;
      }
      if (code) {
        code.lines.push(line);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      const tableSeparator = lines[index + 1]?.match(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/);
      if (line.includes('|') && tableSeparator) {
        flushParagraph();
        flushList();
        const cells = (value) => value.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
        const headerCells = cells(line);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          rows.push(cells(lines[index]));
          index += 1;
        }
        index -= 1;
        output.push(`<table><thead><tr>${headerCells.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headerCells.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      } else if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      } else if (unordered || ordered) {
        flushParagraph();
        const type = unordered ? 'ul' : 'ol';
        if (!list || list.type !== type) {
          flushList();
          list = { type, items: [] };
        }
        list.items.push((unordered || ordered)[1]);
      } else if (/^\s*>\s?/.test(line)) {
        flushParagraph();
        flushList();
        output.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
      } else if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(line)) {
        flushParagraph();
        flushList();
        output.push('<hr />');
      } else if (line.trim()) {
        flushList();
        paragraph.push(line.trim());
      } else {
        flushParagraph();
        flushList();
      }
    }

    flushParagraph();
    flushList();
    if (code) output.push(`<pre><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`);
    return output.join('');
  }

  $: rendered = renderMarkdown(source);
</script>

<div class="markdown-content">{@html rendered}</div>
