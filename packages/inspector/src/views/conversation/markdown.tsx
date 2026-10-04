// Markdown for the conversation's message and reasoning text, on demand (spec 012). Plain text is the default and
// shows exactly what was received; Markdown is a view over the same text and changes nothing in the recording.
//
// markdown-it only parses here. The token list is folded into React elements, so there is no HTML string, no
// sanitizer and no dangerouslySetInnerHTML: the output holds only the elements and attributes written below. Raw
// HTML stays text, images are never loaded, and only http:, https: and mailto: addresses become links.
// specs/012-conversation-markdown/contracts/markdown.md is the contract.
// A program that reaches this file without including the folder, such as the demo's, still finds the declaration.
/// <reference path="./markdown-it.d.ts" />
import { Fragment, createContext, createElement, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import markdownit, { type Token } from 'markdown-it';
import { CodeBlock, SegmentedControl } from '../theme/primitives';

export type TextMode = 'plain' | 'markdown';

/** Longer text shows as plain text: a runaway message must not freeze a tool that is pointed at untrusted servers. */
export const MARKDOWN_LIMIT = 200_000;
export const TOO_LONG_NOTE = 'Too long to format as Markdown. Shown as plain text.';
export const FAILED_NOTE = 'Could not format this as Markdown. Shown as plain text.';

const ModeContext = createContext<TextMode>('plain');
/** The mode for the views below it. Without one, as when a view is mounted on its own, text stays plain. */
export const MarkdownModeProvider = ModeContext.Provider;

export function MarkdownToggle({ mode, onChange }: { mode: TextMode; onChange: (mode: TextMode) => void }): ReactElement {
  return (
    <div className="agui-conv-toolbar">
      <SegmentedControl
        label="Message text"
        value={mode}
        options={[
          { value: 'plain', label: 'Plain text' },
          { value: 'markdown', label: 'Markdown' },
        ]}
        onChange={(value) => onChange(value as TextMode)}
      />
    </div>
  );
}

// CommonMark with tables and strikethrough. html: false keeps raw HTML as text; linkify: false keeps a bare address as text.
const md = markdownit({ html: false, linkify: false, typographer: false, breaks: false });

/** The address of a link that may open, or undefined. No base URL, so relative and protocol-relative addresses fail. */
export function safeLink(href: string): string | undefined {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const dest = (address: string): ReactNode => createElement('span', { className: 'agui-md-dest' }, `(${address})`);

/** One finished element for an open token and what it contained. A token type with no rule keeps its children, never its markup. */
function element(open: Token, children: ReactNode[]): ReactNode {
  switch (open.type) {
    case 'paragraph_open':
      return open.hidden ? createElement(Fragment, null, ...children) : createElement('p', null, ...children);
    case 'heading_open':
      // The page's h1 is the brand and the conversation's h2 is its heading, so a message heading starts at h3.
      return createElement(`h${Math.min((Number(open.tag.slice(1)) || 4) + 2, 6)}`, null, ...children);
    case 'blockquote_open':
      return createElement('blockquote', null, ...children);
    case 'bullet_list_open':
      return createElement('ul', null, ...children);
    case 'ordered_list_open': {
      const raw = open.attrGet('start');
      const start = raw === null ? 1 : Number(raw);
      return createElement('ol', Number.isSafeInteger(start) && start !== 1 ? { start } : null, ...children);
    }
    case 'list_item_open':
      return createElement('li', null, ...children);
    case 'table_open':
      return createElement('div', { className: 'agui-md-scroll', tabIndex: 0, role: 'region', 'aria-label': 'Table' }, createElement('table', null, ...children));
    case 'thead_open':
      return createElement('thead', null, ...children);
    case 'tbody_open':
      return createElement('tbody', null, ...children);
    case 'tr_open':
      return createElement('tr', null, ...children);
    case 'th_open':
    case 'td_open': {
      const align = /^text-align:(left|center|right)$/.exec(open.attrGet('style') ?? '')?.[1];
      return createElement(open.tag === 'th' ? 'th' : 'td', align === undefined ? null : { 'data-align': align }, ...children);
    }
    case 'em_open':
      return createElement('em', null, ...children);
    case 'strong_open':
      return createElement('strong', null, ...children);
    case 's_open':
      return createElement('del', null, ...children);
    case 'link_open': {
      const href = open.attrGet('href') ?? '';
      const address = safeLink(href);
      if (address === undefined) return createElement(Fragment, null, ...children, ' ', dest(href));
      const anchor = createElement('a', { className: 'agui-md-link', href: address, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' }, ...children);
      // <https://x.test> already is its own address.
      return open.markup === 'autolink' ? anchor : createElement(Fragment, null, anchor, ' ', dest(address));
    }
    default:
      return createElement(Fragment, null, ...children);
  }
}

function leaf(token: Token): ReactNode {
  switch (token.type) {
    case 'inline':
      return createElement(Fragment, null, ...fold(token.children ?? []));
    case 'text':
      return token.content;
    case 'code_inline':
      return createElement('code', null, token.content);
    case 'softbreak':
      return '\n';
    case 'hardbreak':
      return createElement('br');
    case 'hr':
      return createElement('hr');
    case 'fence':
    case 'code_block': {
      const language = token.type === 'fence' ? token.info.trim().split(/\s+/)[0]?.slice(0, 40) : undefined;
      return <CodeBlock text={token.content.replace(/\n$/, '')} format="raw" aria-label={language ? `Code, ${language}` : 'Code'} />;
    }
    case 'image':
      // Nothing is requested: an image is its alt text.
      return createElement('span', { className: 'agui-md-inert' }, token.content === '' ? '[image]' : `[image: ${token.content}]`);
    default:
      // Anything else, raw HTML included if it ever came, is text.
      return token.content;
  }
}

// markdown-it stops block nesting at 100 but not run-on emphasis (`***…a…***`), which would nest elements thousands deep.
const MAX_DEPTH = 200;

/** Folds markdown-it's flat token list, where a nesting of 1 opens and -1 closes, into nested elements. */
function fold(tokens: readonly Token[]): ReactNode[] {
  const stack: { open: Token | undefined; children: ReactNode[] }[] = [{ open: undefined, children: [] }];
  for (const token of tokens) {
    if (token.nesting === 1) {
      if (stack.length > MAX_DEPTH) throw new Error('nested too deeply');
      stack.push({ open: token, children: [] });
    } else if (token.nesting === -1) {
      const done = stack.length > 1 ? stack.pop() : undefined;
      if (done?.open !== undefined) stack.at(-1)?.children.push(element(done.open, done.children));
    } else {
      stack.at(-1)?.children.push(leaf(token));
    }
  }
  return stack[0]?.children ?? [];
}

type Formatted = { kind: 'formatted'; nodes: ReactNode[] } | { kind: 'plain'; note: string };

/** The Markdown view of one text, or the note that says why it stays plain. */
export function format(text: string): Formatted {
  if (text.length > MARKDOWN_LIMIT) return { kind: 'plain', note: TOO_LONG_NOTE };
  try {
    return { kind: 'formatted', nodes: fold(md.parse(text, {})) };
  } catch {
    return { kind: 'plain', note: FAILED_NOTE };
  }
}

// Roles whose text is prose. A tool message holds a tool result, and an unknown role is not guessed at.
const PROSE_ROLES: ReadonlySet<string> = new Set(['assistant', 'user', 'system', 'developer']);

/**
 * The text of a message (`role` given) or of reasoning (no role). Plain mode returns the bare string, so the markup is what
 * it was before this view existed. Markdown mode is derived on each draw and memoized on the text; nothing is stored.
 */
export function ConversationText({ text, role }: { text: string; role?: string }): ReactNode {
  const markdown = useContext(ModeContext) === 'markdown' && text !== '' && (role === undefined || PROSE_ROLES.has(role));
  const result = useMemo(() => (markdown ? format(text) : undefined), [markdown, text]);
  if (result === undefined) return text;
  if (result.kind === 'plain') {
    return (
      <>
        <p className="agui-conv-muted agui-md-note">{result.note}</p>
        {text}
      </>
    );
  }
  // Spread, not an array child, so the elements need no keys.
  return createElement('div', { className: 'agui-md' }, ...result.nodes);
}
