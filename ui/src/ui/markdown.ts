import DOMPurify from "dompurify";
import { marked } from "marked";
import { truncateText } from "./format.ts";

marked.setOptions({
  gfm: true,
  breaks: true,
});

const allowedTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "button",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  "img",
];

const allowedAttrs = ["class", "href", "rel", "target", "title", "start", "src", "alt", "type", "aria-label", "data-code"];
const sanitizeOptions = {
  ALLOWED_TAGS: allowedTags,
  ALLOWED_ATTR: allowedAttrs,
  ADD_DATA_URI_TAGS: ["img"],
};

let hooksInstalled = false;
const MARKDOWN_CHAR_LIMIT = 140_000;
const MARKDOWN_PARSE_LIMIT = 40_000;
const MARKDOWN_CACHE_LIMIT = 200;
const MARKDOWN_CACHE_MAX_CHARS = 50_000;
const markdownCache = new Map<string, string>();

function getCachedMarkdown(key: string): string | null {
  const cached = markdownCache.get(key);
  if (cached === undefined) {
    return null;
  }
  markdownCache.delete(key);
  markdownCache.set(key, cached);
  return cached;
}

function setCachedMarkdown(key: string, value: string) {
  markdownCache.set(key, value);
  if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) {
    return;
  }
  const oldest = markdownCache.keys().next().value;
  if (oldest) {
    markdownCache.delete(oldest);
  }
}

function installHooks() {
  if (hooksInstalled) {
    return;
  }
  hooksInstalled = true;

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }
    const href = node.getAttribute("href");
    if (!href) {
      return;
    }
    node.setAttribute("rel", "noreferrer noopener");
    node.setAttribute("target", "_blank");
  });
}

export function toSanitizedMarkdownHtml(markdown: string): string {
  const input = markdown.trim();
  if (!input) {
    return "";
  }
  installHooks();
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCachedMarkdown(input);
    if (cached !== null) {
      return cached;
    }
  }
  const truncated = truncateText(input, MARKDOWN_CHAR_LIMIT);
  const suffix = truncated.truncated
    ? `\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`
    : "";
  if (truncated.text.length > MARKDOWN_PARSE_LIMIT) {
    const escaped = escapeHtml(`${truncated.text}${suffix}`);
    const html = `<pre class="code-block">${escaped}</pre>`;
    const sanitized = DOMPurify.sanitize(html, sanitizeOptions);
    if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
      setCachedMarkdown(input, sanitized);
    }
    return sanitized;
  }
  const rendered = marked.parse(`${truncated.text}${suffix}`, {
    renderer: htmlEscapeRenderer,
  }) as string;
  const sanitized = DOMPurify.sanitize(rendered, sanitizeOptions);
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCachedMarkdown(input, sanitized);
  }
  return sanitized;
}

// Prevent raw HTML in chat messages from being rendered as formatted HTML.
// Display it as escaped text so users see the literal markup.
// Security is handled by DOMPurify, but rendering pasted HTML (e.g. error
// pages) as formatted output is confusing UX (#13937).
const htmlEscapeRenderer = new marked.Renderer();
htmlEscapeRenderer.html = ({ text }: { text: string }) => escapeHtml(text);

// 自定义 code 渲染器：给每个代码块注入复制按钮
// 使用纯文字标签，避免 DOMPurify 过滤 SVG 标签
htmlEscapeRenderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const escaped = escapeHtml(text);
  // data-code 存储 HTML 转义后的代码，浏览器读取 dataset 时会自动解码为原始文本
  const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<pre><button class="code-copy-btn" type="button" title="复制代码" data-code="${escaped}" aria-label="复制代码"><span class="code-copy-btn__label-idle">复制</span><span class="code-copy-btn__label-done">已复制</span></button><code${langClass}>${escaped}</code></pre>`;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
