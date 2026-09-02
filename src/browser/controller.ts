import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";

import type {
  CodexApprovalDecision,
  CodexApprovalRequest,
  DynamicToolCallRequest,
  DynamicToolCallResult,
  DynamicToolSpec
} from "../codex/app-server-runner.js";

export type BrowserControllerOptions = {
  enabled: boolean;
  userDataDir: string;
  outputDir: string;
  executablePath?: string;
  headless: boolean;
  allowedDomains: string[];
  allowedWorkspaces: string[];
};

export type BrowserToolContext = {
  sessionKey: string;
  cwd: string;
  request: DynamicToolCallRequest;
  requestApproval?: (request: CodexApprovalRequest) => Promise<CodexApprovalDecision>;
};

type ElementPreview = {
  ref: string;
  tag: string;
  role: string;
  label: string;
  type: string;
  href: string;
  value: string;
};

const REF_ATTRIBUTE = "data-codex-weixin-ref";
const CONSEQUENT_ACTION = /(?:submit|send|publish|post|save|confirm|approve|authorize|purchase|buy|pay|checkout|delete|remove|sign\s*up|register|apply|book|reserve|place\s+order|提交|发送|发布|保存|确认|授权|购买|支付|结账|删除|移除|注册|申请|预约|下单)/i;

export const BROWSER_DYNAMIC_TOOLS: DynamicToolSpec[] = [{
  type: "namespace",
  name: "weixin_browser",
  description: "Control the isolated codex-weixin browser. Use snapshot refs; consequential actions and file uploads require explicit WeChat approval.",
  tools: [
    {
      type: "function",
      name: "navigate",
      description: "Open a public HTTP(S) URL in the isolated browser. New domains require WeChat approval.",
      inputSchema: objectSchema({ url: { type: "string", description: "Absolute http(s) URL" } }, ["url"])
    },
    {
      type: "function",
      name: "snapshot",
      description: "Read the current page title, URL, visible text, and interactive elements with stable refs.",
      inputSchema: objectSchema({})
    },
    {
      type: "function",
      name: "click",
      description: "Click an element from the latest snapshot by ref. Submit-like actions require WeChat approval.",
      inputSchema: objectSchema({ ref: { type: "string", description: "Element ref such as e12" } }, ["ref"])
    },
    {
      type: "function",
      name: "fill",
      description: "Fill an input or textarea from the latest snapshot. This does not intentionally submit the form.",
      inputSchema: objectSchema({
        ref: { type: "string", description: "Element ref such as e12" },
        value: { type: "string", description: "Text to enter" }
      }, ["ref", "value"])
    },
    {
      type: "function",
      name: "screenshot",
      description: "Capture the current page and return both a local file path and an image input.",
      inputSchema: objectSchema({ fullPage: { type: "boolean", description: "Capture the full page; defaults to false" } })
    },
    {
      type: "function",
      name: "upload",
      description: "Upload one local file through a file input. The file must be inside an allowed workspace and always requires WeChat approval.",
      inputSchema: objectSchema({
        ref: { type: "string", description: "File input ref" },
        path: { type: "string", description: "Absolute local file path" }
      }, ["ref", "path"])
    }
  ]
}];

export class BrowserController {
  private contextPromise?: Promise<BrowserContext>;
  private readonly pages = new Map<string, Page>();
  private readonly tabDomains = new Map<string, Set<string>>();
  private readonly sessionDomains = new Map<string, Set<string>>();

  constructor(private readonly options: BrowserControllerOptions) {}

  get enabled(): boolean {
    return this.options.enabled;
  }

  async call(context: BrowserToolContext): Promise<DynamicToolCallResult> {
    if (!this.options.enabled) return failure("浏览器控制未启用。");
    if (context.request.namespace !== "weixin_browser") {
      return failure(`不支持的动态工具命名空间：${context.request.namespace ?? "(none)"}`);
    }
    try {
      const args = asObject(context.request.arguments);
      switch (context.request.tool) {
        case "navigate":
          return await this.navigate(context, requiredString(args, "url"));
        case "snapshot":
          return success(await this.snapshot(await this.pageFor(context.sessionKey)));
        case "click":
          return await this.click(context, requiredString(args, "ref"));
        case "fill":
          return await this.fill(context, requiredString(args, "ref"), requiredString(args, "value", true));
        case "screenshot":
          return await this.screenshot(context, args.fullPage === true);
        case "upload":
          return await this.upload(context, requiredString(args, "ref"), requiredString(args, "path"));
        default:
          return failure(`未知浏览器工具：${context.request.tool}`);
      }
    } catch (error) {
      return failure(browserError(error));
    }
  }

  async close(): Promise<void> {
    const context = await this.contextPromise?.catch(() => undefined);
    this.contextPromise = undefined;
    this.pages.clear();
    this.tabDomains.clear();
    this.sessionDomains.clear();
    await context?.close().catch(() => undefined);
  }

  private async navigate(context: BrowserToolContext, rawUrl: string): Promise<DynamicToolCallResult> {
    const url = await validatePublicUrl(rawUrl);
    const host = normalizeDomain(url.hostname);
    if (!this.isDomainAllowed(context.sessionKey, host)) {
      const decision = await this.approve(context, {
        kind: "browserNavigation",
        title: "允许浏览器访问新网站",
        detail: `网站：${url.origin}\n完整地址：${url.href}`,
        allowForSession: true
      });
      if (!isAccepted(decision)) return failure(`用户未批准访问 ${url.origin}。`);
      const domains = decision === "acceptForSession"
        ? this.sessionDomains.get(context.sessionKey) ?? new Set<string>()
        : this.tabDomains.get(context.sessionKey) ?? new Set<string>();
      domains.add(host);
      if (decision === "acceptForSession") this.sessionDomains.set(context.sessionKey, domains);
      else this.tabDomains.set(context.sessionKey, domains);
    }
    const page = await this.pageFor(context.sessionKey);
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const finalUrl = new URL(page.url());
    const finalHost = normalizeDomain(finalUrl.hostname);
    if (!this.isDomainAllowed(context.sessionKey, finalHost)) {
      await page.goto("about:blank");
      return failure(`页面重定向到未经批准的域名 ${finalHost}，已停止加载。`);
    }
    return success(JSON.stringify({
      url: page.url(),
      title: await page.title(),
      status: response?.status() ?? null,
      snapshot: JSON.parse(await this.snapshot(page))
    }, null, 2));
  }

  private async click(context: BrowserToolContext, ref: string): Promise<DynamicToolCallResult> {
    const page = await this.pageFor(context.sessionKey);
    const locator = locatorFor(page, ref);
    const before = await elementPreview(locator, ref);
    if (isConsequentialBrowserElement(before)) {
      const decision = await this.approve(context, {
        kind: "browserAction",
        title: "确认网页上的外部操作",
        detail: `页面：${page.url()}\n操作：点击 ${describeElement(before)}\n该按钮可能提交、发送、保存或改变外部网站数据。`,
        allowForSession: false
      });
      if (!isAccepted(decision)) return failure("用户未批准此网页操作。");
      const current = await elementPreview(locator, ref);
      if (fingerprint(current) !== fingerprint(before)) {
        return failure("等待确认期间页面元素发生变化，已拒绝执行；请重新 snapshot。 ");
      }
    }
    const navigationTarget = before.href ? await validatePublicUrl(before.href, page.url()) : undefined;
    if (navigationTarget && !this.isDomainAllowed(context.sessionKey, normalizeDomain(navigationTarget.hostname))) {
      return failure(`链接将打开未经批准的域名 ${navigationTarget.hostname}；请先使用 navigate 请求访问。`);
    }
    await locator.click({ timeout: 15_000 });
    await page.waitForTimeout(300);
    return success(await this.snapshot(page));
  }

  private async fill(context: BrowserToolContext, ref: string, value: string): Promise<DynamicToolCallResult> {
    const page = await this.pageFor(context.sessionKey);
    const locator = locatorFor(page, ref);
    const preview = await elementPreview(locator, ref);
    if (!(["input", "textarea", "select"].includes(preview.tag))) {
      return failure(`${ref} 不是可填写的输入控件。`);
    }
    if (preview.type === "file") return failure("文件输入必须使用 upload 工具并经过审批。");
    if (preview.tag === "select") await locator.selectOption(value);
    else await locator.fill(value);
    return success(JSON.stringify({ filled: ref, element: preview, valueLength: value.length }, null, 2));
  }

  private async screenshot(context: BrowserToolContext, fullPage: boolean): Promise<DynamicToolCallResult> {
    const page = await this.pageFor(context.sessionKey);
    fs.mkdirSync(this.options.outputDir, { recursive: true });
    const filePath = path.join(this.options.outputDir, `browser-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`);
    const bytes = await page.screenshot({ path: filePath, fullPage });
    return {
      success: true,
      contentItems: [
        { type: "inputText", text: `浏览器截图已保存：${filePath}` },
        { type: "inputImage", imageUrl: `data:image/png;base64,${bytes.toString("base64")}` }
      ]
    };
  }

  private async upload(context: BrowserToolContext, ref: string, rawPath: string): Promise<DynamicToolCallResult> {
    const filePath = path.resolve(rawPath);
    if (!this.options.allowedWorkspaces.some((root) => isWithin(filePath, root))) {
      return failure("只能上传允许工作目录内的文件。");
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return failure("上传路径不是普通文件。");
    const decision = await this.approve(context, {
      kind: "browserUpload",
      title: "确认向网站上传本机文件",
      detail: `页面：${(await this.pageFor(context.sessionKey)).url()}\n文件：${filePath}\n大小：${stat.size} bytes`,
      allowForSession: false
    });
    if (!isAccepted(decision)) return failure("用户未批准文件上传。");
    const page = await this.pageFor(context.sessionKey);
    const locator = locatorFor(page, ref);
    const preview = await elementPreview(locator, ref);
    if (preview.tag !== "input" || preview.type !== "file") return failure(`${ref} 不是文件输入控件。`);
    await locator.setInputFiles(filePath);
    return success(`已选择上传文件：${path.basename(filePath)}。如页面还需点击提交，该点击会再次请求审批。`);
  }

  private async approve(
    context: BrowserToolContext,
    input: Pick<CodexApprovalRequest, "kind" | "title" | "detail" | "allowForSession">
  ): Promise<CodexApprovalDecision> {
    if (!context.requestApproval) return "decline";
    return context.requestApproval({
      ...input,
      threadId: context.request.threadId,
      turnId: context.request.turnId,
      itemId: context.request.callId
    });
  }

  private async pageFor(sessionKey: string): Promise<Page> {
    const existing = this.pages.get(sessionKey);
    if (existing && !existing.isClosed()) return existing;
    const context = await this.browserContext();
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const target = new URL(request.url());
        if (["http:", "https:"].includes(target.protocol)) {
          await validatePublicUrl(target.href);
        } else if (!["about:", "blob:", "data:"].includes(target.protocol)) {
          await route.abort("blockedbyclient");
          return;
        }
        if (request.isNavigationRequest()
          && request.frame() === page.mainFrame()
          && target.protocol !== "about:"
          && !this.isDomainAllowed(sessionKey, normalizeDomain(target.hostname))) {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    page.on("popup", (popup) => {
      void popup.close().catch(() => undefined);
    });
    this.pages.set(sessionKey, page);
    return page;
  }

  private async browserContext(): Promise<BrowserContext> {
    if (!this.contextPromise) {
      this.contextPromise = this.launchContext();
    }
    return this.contextPromise;
  }

  private async launchContext(): Promise<BrowserContext> {
    const executablePath = resolveBrowserExecutable(this.options.executablePath);
    fs.mkdirSync(this.options.userDataDir, { recursive: true });
    const context = await chromium.launchPersistentContext(this.options.userDataDir, {
      executablePath,
      headless: this.options.headless,
      viewport: this.options.headless ? { width: 1440, height: 1000 } : null,
      acceptDownloads: true,
      args: ["--disable-background-networking", "--disable-component-update"]
    });
    context.once("close", () => {
      this.contextPromise = undefined;
      this.pages.clear();
      this.tabDomains.clear();
    });
    return context;
  }

  private isDomainAllowed(sessionKey: string, host: string): boolean {
    return matchesDomain(host, this.options.allowedDomains)
      || matchesDomain(host, Array.from(this.tabDomains.get(sessionKey) ?? []))
      || matchesDomain(host, Array.from(this.sessionDomains.get(sessionKey) ?? []));
  }

  private async snapshot(page: Page): Promise<string> {
    const controls = await page.locator("a[href],button,input,textarea,select,[role=button],[contenteditable=true]")
      .evaluateAll((elements, refAttribute) => {
        let next = 1;
        return elements.slice(0, 150).flatMap((element) => {
          const html = element as HTMLElement;
          const style = window.getComputedStyle(html);
          const rect = html.getBoundingClientRect();
          if (style.visibility === "hidden" || style.display === "none" || rect.width === 0 || rect.height === 0) return [];
          const ref = `e${next++}`;
          html.setAttribute(refAttribute, ref);
          const input = html as HTMLInputElement;
          const anchor = html as HTMLAnchorElement;
          const label = (html.getAttribute("aria-label") || html.innerText || input.placeholder || input.name || "")
            .replace(/\s+/g, " ").trim().slice(0, 200);
          return [{
            ref,
            tag: html.tagName.toLowerCase(),
            role: html.getAttribute("role") || "",
            label,
            type: input.type || "",
            href: anchor.href || "",
            value: input.type === "password" ? "[password]" : String(input.value || "").slice(0, 200)
          }];
        });
      }, REF_ATTRIBUTE) as ElementPreview[];
    const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    return JSON.stringify({
      url: page.url(),
      title: await page.title(),
      text: text.replace(/\s+\n/g, "\n").trim().slice(0, 8_000),
      controls
    }, null, 2);
  }
}

export function resolveBrowserExecutable(configured?: string): string {
  if (configured?.trim()) {
    const resolved = path.resolve(configured.trim());
    if (!fs.existsSync(resolved)) throw new Error(`配置的浏览器不存在：${resolved}`);
    return resolved;
  }
  const candidates = browserExecutableCandidates();
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  const bundled = chromium.executablePath();
  if (bundled && fs.existsSync(bundled)) return bundled;
  throw new Error("没有找到 Chrome、Edge、Brave 或 Chromium；请在设置中填写浏览器程序路径。");
}

function browserExecutableCandidates(): string[] {
  if (process.platform === "win32") {
    return [
      path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
    ].filter((candidate) => path.isAbsolute(candidate));
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

async function validatePublicUrl(rawUrl: string, base?: string): Promise<URL> {
  const url = new URL(rawUrl, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("浏览器只允许 http 或 https 地址。");
  if (url.username || url.password) throw new Error("网址不得包含用户名或密码。");
  const host = normalizeDomain(url.hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("浏览器禁止访问本机或局域网地址。");
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("浏览器禁止访问本机或私有网络地址。");
  } else {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error("域名解析到本机或私有网络地址，已拒绝访问。");
    }
  }
  return url;
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  const ipv4 = mapped?.[1] ?? (net.isIPv4(normalized) ? normalized : undefined);
  if (!ipv4) return false;
  const parts = ipv4.split(".").map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

function matchesDomain(host: string, domains: string[]): boolean {
  return domains.some((raw) => {
    const domain = normalizeDomain(raw);
    return domain && (host === domain || host.endsWith(`.${domain}`));
  });
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function locatorFor(page: Page, ref: string): Locator {
  if (!/^e[1-9]\d*$/.test(ref)) throw new Error("无效元素编号；请重新 snapshot。");
  const locator = page.locator(`[${REF_ATTRIBUTE}="${ref}"]`);
  return locator;
}

async function elementPreview(locator: Locator, ref: string): Promise<ElementPreview> {
  if (await locator.count() !== 1) throw new Error(`${ref} 已失效或不唯一；请重新 snapshot。`);
  return locator.evaluate((element, input) => {
    const html = element as HTMLElement;
    const formInput = html as HTMLInputElement;
    const anchor = html as HTMLAnchorElement;
    return {
      ref: input.ref,
      tag: html.tagName.toLowerCase(),
      role: html.getAttribute("role") || "",
      label: (html.getAttribute("aria-label") || html.innerText || formInput.value || formInput.placeholder || formInput.name || "").replace(/\s+/g, " ").trim().slice(0, 200),
      type: formInput.type || "",
      href: anchor.href || "",
      value: formInput.type === "password" ? "[password]" : String(formInput.value || "").slice(0, 200)
    };
  }, { ref });
}

export function isConsequentialBrowserElement(element: Pick<ElementPreview, "tag" | "type" | "label" | "href">): boolean {
  if (element.type === "submit") return true;
  if (element.tag === "button" && (!element.type || element.type === "submit")) return true;
  return CONSEQUENT_ACTION.test(`${element.label} ${element.href}`);
}

function describeElement(element: ElementPreview): string {
  return [element.tag, element.type && `type=${element.type}`, element.label && `“${element.label}”`, element.href].filter(Boolean).join(" ");
}

function fingerprint(element: ElementPreview): string {
  return JSON.stringify([element.tag, element.role, element.label, element.type, element.href]);
}

function isAccepted(decision: CodexApprovalDecision): boolean {
  return decision === "accept" || decision === "acceptForSession";
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requiredString(input: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = input[key];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`缺少字符串参数：${key}`);
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("浏览器工具参数必须是对象。");
  return value as Record<string, unknown>;
}

function success(text: string): DynamicToolCallResult {
  return { success: true, contentItems: [{ type: "inputText", text }] };
}

function failure(text: string): DynamicToolCallResult {
  return { success: false, contentItems: [{ type: "inputText", text }] };
}

function browserError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `浏览器操作失败：${message.slice(0, 1_000)}`;
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

export function defaultBrowserProfileDir(): string {
  return path.join(os.homedir(), ".codex-weixin", "browser-profile");
}
