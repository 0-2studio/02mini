#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'child_process';
import dns from 'dns/promises';
import net from 'net';
import { promisify } from 'util';

const DEFAULT_LIMIT = Number.parseInt(process.env.DEFAULT_LIMIT || '50000', 10);
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.FETCH_TIMEOUT_MS || '30000', 10);
const DEFAULT_PROXY = process.env.FETCH_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const execFileAsync = promisify(execFile);

type FetchMode = 'html' | 'text' | 'json' | 'markdown' | 'readable' | 'youtube';

const toolDefs = [
  ['fetch_html', 'Fetch a URL and return raw HTML.', 'html'],
  ['fetch_text', 'Fetch a URL and return plain text.', 'text'],
  ['fetch_txt', 'Fetch a URL and return plain text.', 'text'],
  ['fetch_json', 'Fetch a URL and parse JSON.', 'json'],
  ['fetch_markdown', 'Fetch a URL and return simple Markdown-like text.', 'markdown'],
  ['fetch_readable', 'Fetch a URL and extract readable article-like Markdown.', 'readable'],
  ['fetch_youtube_transcript', 'Fetch a YouTube page and extract available transcript text when present.', 'youtube'],
] as const;

const server = new Server(
  { name: '02mini-fetch', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefs.map(([name, description]) => ({
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP or HTTPS URL to fetch' },
        headers: { type: 'object', description: 'Optional request headers' },
        proxy: { type: 'string', description: 'Optional proxy URL. Use \"direct\" or \"none\" to bypass the default proxy.' },
        no_proxy: { type: 'boolean', description: 'Bypass the default proxy for this request' },
        max_length: { type: 'number', description: 'Maximum characters to return' },
        start_index: { type: 'number', description: 'Start character index' },
        lang: { type: 'string', description: 'Preferred transcript language for YouTube transcript requests' },
      },
      required: ['url'],
    },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const def = toolDefs.find(([name]) => name === request.params.name);
  if (!def) throw new Error(`Unknown tool: ${request.params.name}`);

  const args = (request.params.arguments || {}) as Record<string, unknown>;
  const result = await fetchUrl(def[2], args);
  return { content: [{ type: 'text', text: result }] };
});

async function fetchUrl(mode: FetchMode, args: Record<string, unknown>): Promise<string> {
  const rawUrl = requiredString(args.url, 'url');
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported');
  }

  await assertSafePublicHostname(url.hostname);

  const fetched = await fetchRaw(url, args);
  const text = mode === 'json' ? normalizeJson(fetched.body) : fetched.body;
  const body = formatBody(mode, text);
  const statusLine = `Status: ${fetched.status}\nContent-Type: ${fetched.contentType || 'unknown'}\nURL: ${fetched.url}\nChannel: ${fetched.channel}\n\n`;
  return paginate(statusLine + body, args);
}

async function fetchRaw(url: URL, args: Record<string, unknown>): Promise<{ status: string; contentType?: string; url: string; body: string; channel: 'direct' | 'proxy' }> {
  const proxyArg = typeof args.proxy === 'string' ? args.proxy.trim() : '';
  const forceDirect = args.no_proxy === true || ['direct', 'none', 'off', 'false', '0'].includes(proxyArg.toLowerCase());
  const explicitProxy = proxyArg && !forceDirect ? proxyArg : '';
  const shouldUseDefaultProxy = !forceDirect && !explicitProxy && DEFAULT_PROXY && await hostnameUsesFakeIp(url.hostname);
  const proxy = explicitProxy || (shouldUseDefaultProxy ? DEFAULT_PROXY : '');
  if (proxy) {
    try {
      return await fetchWithCurl(url, args, proxy);
    } catch (error) {
      if (!isLikelyCurlTlsError(error)) throw error;
      try {
        return await fetchWithCurl(url, args, proxy, ['--ssl-no-revoke']);
      } catch {
        return fetchDirect(url, args);
      }
    }
  }

  return fetchDirect(url, args);
}

async function fetchDirect(url: URL, args: Record<string, unknown>): Promise<{ status: string; contentType?: string; url: string; body: string; channel: 'direct' }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: normalizeHeaders(args.headers),
      redirect: 'follow',
      signal: controller.signal,
    });
    return {
      status: `${response.status} ${response.statusText}`,
      contentType: response.headers.get('content-type') || undefined,
      url: response.url,
      body: await response.text(),
      channel: 'direct',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithCurl(url: URL, args: Record<string, unknown>, proxy: string, extraCurlArgs: string[] = []): Promise<{ status: string; contentType?: string; url: string; body: string; channel: 'proxy' }> {
  const headers = normalizeHeaders(args.headers) || {};
  const curlArgs = [
    '-L',
    '-sS',
    '--max-time', String(Math.ceil(DEFAULT_TIMEOUT_MS / 1000)),
    ...extraCurlArgs,
    '--proxy', proxy,
    '-w', '\n__02MINI_FETCH_STATUS__%{http_code}\n__02MINI_FETCH_TYPE__%{content_type}\n__02MINI_FETCH_URL__%{url_effective}\n',
  ];
  for (const [key, value] of Object.entries(headers)) {
    curlArgs.push('-H', `${key}: ${value}`);
  }
  curlArgs.push(url.toString());

  const { stdout } = await execFileAsync('curl.exe', curlArgs, {
    timeout: DEFAULT_TIMEOUT_MS + 5000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = String(stdout);
  const marker = '\n__02MINI_FETCH_STATUS__';
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex < 0) return { status: 'unknown', url: url.toString(), body: output, channel: 'proxy' };

  const body = output.slice(0, markerIndex);
  const meta = output.slice(markerIndex + 1);
  return {
    status: meta.match(/__02MINI_FETCH_STATUS__(.*)/)?.[1]?.trim() || 'unknown',
    contentType: meta.match(/__02MINI_FETCH_TYPE__(.*)/)?.[1]?.trim() || undefined,
    url: meta.match(/__02MINI_FETCH_URL__(.*)/)?.[1]?.trim() || url.toString(),
    body,
    channel: 'proxy',
  };
}

function isLikelyCurlTlsError(error: unknown): boolean {
  const withStderr = error as Error & { stderr?: unknown };
  const text = error instanceof Error ? `${error.message}\n${withStderr.stderr || ''}` : String(error);
  return /schannel|ssl|tls|handshake|certificate|revocation/i.test(text);
}

function normalizeJson(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2);
}

async function assertSafePublicHostname(hostname: string): Promise<void> {
  const clean = hostname.replace(/^\[|\]$/g, '');
  if (clean === 'localhost' || clean.endsWith('.localhost')) {
    throw new Error(`Blocked localhost hostname: ${hostname}`);
  }

  if (net.isIP(clean)) {
    if (isBlockedIp(clean)) throw new Error(`Blocked private/local IP address: ${clean}`);
    return;
  }

  // In Clash/Mihomo TUN fake-ip mode public domains may resolve to 198.18.0.0/15.
  // That range is allowed here for hostnames only; direct numeric 198.18.* URLs remain blocked.
  const records = await dns.lookup(clean, { all: true }).catch(() => [] as Array<{ address: string; family: number }>);
  for (const record of records) {
    if (isBlockedIp(record.address) && !isClashFakeIp(record.address)) {
      throw new Error(`Blocked hostname ${hostname}: resolved to private/local IP ${record.address}`);
    }
  }
}

async function hostnameUsesFakeIp(hostname: string): Promise<boolean> {
  const clean = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(clean)) return false;
  const records = await dns.lookup(clean, { all: true }).catch(() => [] as Array<{ address: string; family: number }>);
  return records.some(record => isClashFakeIp(record.address));
}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19);
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
}

function isClashFakeIp(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 198 && (b === 18 || b === 19);
}

function normalizeHeaders(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') headers[key] = value;
  }
  return headers;
}

function htmlToText(input: string, markdown: boolean): string {
  let text = input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, markdown ? '- ' : '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

function formatBody(mode: FetchMode, text: string): string {
  if (mode === 'html' || mode === 'json') return text;
  if (mode === 'youtube') return extractYouTubeTranscript(text) || htmlToText(text, true);
  const nextData = extractNextDraftArticle(text);
  if ((mode === 'readable' || mode === 'markdown') && nextData) return nextData;
  if (mode === 'readable') return extractReadable(text);
  return htmlToText(text, mode === 'markdown');
}

function extractNextDraftArticle(input: string): string | undefined {
  if (!input.includes('self.__next_f.push') || !input.includes('\\\"blocks\\\"')) return undefined;

  const articleStart = input.lastIndexOf('\\"article\\":{');
  const articleSlice = articleStart >= 0 ? input.slice(articleStart) : input;
  const articleTitle = extractEscapedJsonString(articleSlice, 'title') || extractHtmlTitle(input);
  const contentRaw = extractEscapedJsonString(articleSlice, 'content');
  if (!contentRaw) return undefined;

  let draft: { blocks?: Array<{ text?: string; type?: string; depth?: number }> };
  try {
    draft = JSON.parse(contentRaw);
  } catch {
    return undefined;
  }

  const lines: string[] = [];
  if (articleTitle) lines.push(`# ${articleTitle}`, '');

  for (const block of draft.blocks || []) {
    const rawText = typeof block.text === 'string' ? block.text.trim() : '';
    if (!rawText) continue;
    const type = block.type || 'unstyled';
    const depth = typeof block.depth === 'number' ? block.depth : 0;
    const indent = '  '.repeat(Math.max(0, depth));
    if (type === 'header-one') lines.push(`# ${rawText}`);
    else if (type === 'header-two') lines.push(`## ${rawText}`);
    else if (type === 'header-three') lines.push(`### ${rawText}`);
    else if (type === 'unordered-list-item') lines.push(`${indent}- ${rawText}`);
    else if (type === 'ordered-list-item') lines.push(`${indent}1. ${rawText}`);
    else if (type === 'blockquote') lines.push(`> ${rawText}`);
    else lines.push(rawText);
    lines.push('');
  }

  const result = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return result || undefined;
}

function extractEscapedJsonString(input: string, key: string): string | undefined {
  const marker = `\\\"${key}\\\":\\\"`;
  const start = input.indexOf(marker);
  if (start < 0) return undefined;
  let i = start + marker.length;
  let value = '';
  while (i < input.length) {
    const char = input[i];
    if (char === '\\') {
      const next = input[i + 1];
      if (next === '\\' && input[i + 2] === '\"') {
        value += '\\"';
        i += 3;
        continue;
      }
      value += char + (next || '');
      i += 2;
      continue;
    }
    if (char === '\"') break;
    value += char;
    i++;
  }
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\u0026/g, '&');
  }
}

function extractHtmlTitle(input: string): string | undefined {
  return input.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
}

function extractReadable(input: string): string {
  const main = extractFirst(input, /<article[\s\S]*?<\/article>/i)
    || extractFirst(input, /<main[\s\S]*?<\/main>/i)
    || extractFirst(input, /<body[\s\S]*?<\/body>/i)
    || input;
  return htmlToText(main, true);
}

function extractFirst(input: string, pattern: RegExp): string | undefined {
  return input.match(pattern)?.[0];
}

function extractYouTubeTranscript(input: string): string | undefined {
  const decoded = input.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const captions = decoded.match(/"captionTracks":\s*(\[[\s\S]*?\])/);
  if (!captions) return undefined;
  return `YouTube caption tracks detected. Direct transcript extraction is limited in this lightweight fetch server. Caption metadata:\n${captions[1].slice(0, 5000)}`;
}

function paginate(text: string, args: Record<string, unknown>): string {
  const start = typeof args.start_index === 'number' && args.start_index > 0 ? Math.floor(args.start_index) : 0;
  const limit = typeof args.max_length === 'number' && args.max_length >= 0 ? Math.floor(args.max_length) : DEFAULT_LIMIT;
  return limit === 0 ? text.slice(start) : text.slice(start, start + limit);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

await server.connect(new StdioServerTransport());
