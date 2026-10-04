// The part of markdown-it 14 that the Markdown view uses. The package ships no types, and the view only parses:
// it never calls render(), so no HTML string exists. Kept to what is used so a new call has to be declared on purpose.
declare module 'markdown-it' {
  export interface Token {
    type: string;
    tag: string;
    nesting: -1 | 0 | 1;
    content: string;
    info: string;
    markup: string;
    hidden: boolean;
    attrs: [string, string][] | null;
    children: Token[] | null;
    attrGet(name: string): string | null;
  }

  export interface Options {
    html: boolean;
    linkify: boolean;
    typographer: boolean;
    breaks: boolean;
  }

  export interface MarkdownIt {
    parse(src: string, env: object): Token[];
  }

  export default function markdownit(options: Options): MarkdownIt;
}
