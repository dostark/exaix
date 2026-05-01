/**
 * @module RequestService
 * @path src/services/request/request.ts
 * @description Core service for managing agent requests.
 * @architectural-layer Services
 * @related-files [src/cli/commands/request_commands.ts, "packages/core/src/types/i_request_service.ts"]
 */

import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import { RequestStatus, type RequestStatusType } from "@exaix/core/status/request_status.ts";
import { DEFAULT_IDENTITY_ID, RequestPriority, RequestSource } from "@exaix/core";
import type { IRequestEntry, IRequestMetadata, IRequestOptions, IRequestShowResult } from "@exaix/core/types/mod.ts";
import type { IDisplayService } from "@exaix/core/types/i_display_service.ts";
import type { IApplicationContext, IConfigService } from "@exaix/core/types";
import type { IRequestAnalysis } from "@exaix/schemas/request_analysis.ts";
import { loadAnalysis, RequestAnalyzer, saveAnalysis } from "../request_analysis/mod.ts";
import type { IDatabaseService } from "../core/db.ts";
import { AnalysisMode } from "@exaix/core/types/mod.ts";
import type { JSONValue } from "@exaix/core";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IOutputValidator } from "../tool/output_validator.ts";

export interface IRequestServiceConfig {
  config: Config;
  configService: IConfigService;
  display: IDisplayService;
  userIdentityGetter: () => Promise<string>;
  provider?: IModelProvider;
  validator?: IOutputValidator;
  db?: IDatabaseService;
  context?: IApplicationContext;
}

export class RequestService {
  private requestsDir: string;
  private config: Config;
  private configService: IConfigService;
  private display: IDisplayService;
  private userIdentityGetter: () => Promise<string>;
  private provider?: IModelProvider;
  private validator?: IOutputValidator;
  private db?: IDatabaseService;

  constructor(options: IRequestServiceConfig) {
    const ctx = options.context;
    this.configService = ctx?.config || options.configService;
    this.config = ctx?.config.get() || options.config;
    this.display = ctx?.display || options.display;
    this.userIdentityGetter = options.userIdentityGetter;
    this.provider = ctx?.provider || options.provider;
    this.validator = options.validator;
    this.db = ctx?.db || options.db;

    const root = this.config.system.root!;
    const workspace = this.config.paths.workspace!;
    this.requestsDir = join(root, workspace, this.config.paths.requests!);
  }

  private parseFrontmatter(raw: string): Record<string, string> {
    const fm: Record<string, string> = {};
    raw.split("\n").forEach((line) => {
      const parts = line.split(":");
      if (parts.length >= 2) fm[parts[0].trim()] = parts.slice(1).join(":").trim().replace(/"/g, "");
    });
    return fm;
  }

  async create(
    description: string,
    options: IRequestOptions = {},
    source: RequestSource = RequestSource.CLI,
  ): Promise<IRequestMetadata> {
    const trimmedDescription = description.trim();
    if (!trimmedDescription) throw new Error("Description cannot be empty");

    const priority = options.priority || RequestPriority.NORMAL;
    const identity = options.identity || DEFAULT_IDENTITY_ID;
    const portal = options.portal;

    const trace_id = crypto.randomUUID();
    const shortId = trace_id.slice(0, 8);
    const filename = `request-${shortId}.md`;
    const path = join(this.requestsDir, filename);

    const created_by = await this.userIdentityGetter();
    const created = new Date().toISOString();

    const subject = options.subject || trimmedDescription.split("\n")[0].substring(0, 80);

    const frontmatterFields: Record<string, JSONValue> = {
      trace_id,
      created,
      status: RequestStatus.PENDING,
      priority,
      identity,
      source,
      created_by,
      subject,
      subject_is_fallback: !options.subject?.trim(),
    };

    if (portal) frontmatterFields.portal = portal;
    if (options.target_branch) frontmatterFields.target_branch = options.target_branch;
    if (options.model) frontmatterFields.model = options.model;
    if (options.flow) frontmatterFields.flow = options.flow;
    if (options.skills && options.skills.length > 0) {
      frontmatterFields.skills = JSON.stringify(options.skills);
    }

    const yamlLines = Object.entries(frontmatterFields)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        const str = String(v);
        return (str.includes(":") || str.includes("-")) ? `${k}: "${str}"` : `${k}: ${str}`;
      });

    const content = `---\n${yamlLines.join("\n")}\n---\n\n# Request\n\n${trimmedDescription}\n`;

    await ensureDir(this.requestsDir);
    await Deno.writeTextFile(path, content);

    await this.display.info("request.created", path, {
      trace_id,
      priority,
      identity,
      portal: portal || null,
      source,
      created_by,
    });

    return {
      trace_id,
      filename,
      path,
      status: RequestStatus.PENDING,
      priority,
      identity,
      portal,
      target_branch: options.target_branch,
      model: options.model,
      flow: options.flow,
      skills: options.skills,
      created,
      created_by,
      source,
      subject,
    };
  }

  async list(status?: RequestStatusType, _includeArchived?: boolean): Promise<IRequestEntry[]> {
    const entries: IRequestEntry[] = [];
    if (!await exists(this.requestsDir)) return [];

    for await (const entry of Deno.readDir(this.requestsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;

      const path = join(this.requestsDir, entry.name);
      const content = await Deno.readTextFile(path);

      // Basic frontmatter parse
      const match = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (!match) continue;

      const fm = this.parseFrontmatter(match[1]);

      if (status && fm.status !== status) continue;

      entries.push(this.toRequestEntry(fm, entry.name, path));
    }

    return entries.sort((a, b) => b.created.localeCompare(a.created));
  }

  async show(idOrFilename: string): Promise<IRequestShowResult> {
    let filename = idOrFilename;
    if (!filename.endsWith(".md")) {
      const list = await this.list();
      const found = list.find((e) => e.trace_id === idOrFilename || e.trace_id.startsWith(idOrFilename));
      if (found) filename = found.filename;
      else filename = `request-${idOrFilename}.md`;
    }

    const path = join(this.requestsDir, filename);
    if (!await exists(path)) throw new Error(`Request not found: ${idOrFilename}`);

    const content = await Deno.readTextFile(path);
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

    if (!match) {
      return {
        metadata: {
          trace_id: "",
          filename,
          status: RequestStatus.PENDING,
          priority: RequestPriority.NORMAL,
          identity: DEFAULT_IDENTITY_ID,
          created: "",
          created_by: "unknown",
          source: RequestSource.CLI,
          subject: "",
        },
        content: content.trim(),
      };
    }

    const fm = this.parseFrontmatter(match[1]);

    return {
      metadata: {
        trace_id: fm.trace_id || "",
        filename,
        status: fm.status as RequestStatusType,
        priority: this.parsePriority(fm.priority),
        identity: fm.identity || DEFAULT_IDENTITY_ID,
        portal: fm.portal,
        created: fm.created || "",
        created_by: fm.created_by || "unknown",
        source: this.parseSource(fm.source),
        subject: fm.subject || "",
      },
      content: match[2].trim(),
    };
  }

  async getRequestContent(requestId: string): Promise<string> {
    const _res = await this.show(requestId);
    return _res.content;
  }

  async updateRequestStatus(requestId: string, status: RequestStatusType): Promise<boolean> {
    try {
      const _res = await this.show(requestId);
      const filename = requestId.endsWith(".md")
        ? requestId
        : (await this.findFilename(requestId) || `request-${requestId}.md`);
      const path = join(this.requestsDir, filename);

      const content = await Deno.readTextFile(path);
      const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) return false;

      const lines = match[1].split("\n");
      const newLines = lines.map((line) => {
        if (line.trim().startsWith("status:")) return `status: ${status}`;
        return line;
      });

      const newContent = `---\n${newLines.join("\n")}\n---\n${match[2]}`;
      await Deno.writeTextFile(path, newContent);
      return true;
    } catch {
      return false;
    }
  }

  async getAnalysis(requestId: string): Promise<IRequestAnalysis | null> {
    const filename = await this.findFilename(requestId);
    if (!filename) return null;
    const path = join(this.requestsDir, filename);
    return loadAnalysis(path);
  }

  async analyze(requestId: string, options: { mode?: AnalysisMode; force?: boolean } = {}): Promise<IRequestAnalysis> {
    const filename = await this.findFilename(requestId);
    if (!filename) throw new Error(`Request not found: ${requestId}`);
    const path = join(this.requestsDir, filename);

    // Return cached analysis unless caller explicitly requests a fresh run
    if (!options.force) {
      const cached = await loadAnalysis(path);
      if (cached) return cached;
    }

    // Read request body
    const content = await Deno.readTextFile(path);
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

    // Get metadata from show() to get priority/agent
    const { metadata } = await this.show(filename);

    const analyzer = new RequestAnalyzer(
      {
        mode: options.mode || (this.config.request_analysis?.mode as AnalysisMode) || AnalysisMode.HYBRID,
        actionabilityThreshold: this.config.request_analysis?.actionability_threshold,
        inferAcceptanceCriteria: this.config.request_analysis?.infer_acceptance_criteria,
      },
      this.provider,
      this.validator,
      this.db,
    );

    const analysis = await analyzer.analyze(body, {
      identityId: metadata.identity || DEFAULT_IDENTITY_ID,
      priority: metadata.priority,
      requestFilePath: path,
      traceId: metadata.trace_id,
    });

    await saveAnalysis(path, analysis);
    return analysis;
  }

  private toRequestEntry(fm: Record<string, string>, filename: string, path: string): IRequestEntry {
    return {
      trace_id: fm.trace_id || "",
      filename,
      path,
      status: fm.status as RequestStatusType,
      priority: this.parsePriority(fm.priority),
      identity: fm.identity || DEFAULT_IDENTITY_ID,
      created: fm.created || "",
      created_by: fm.created_by || "unknown",
      source: this.parseSource(fm.source),
      subject: fm.subject || "",
    };
  }

  private parsePriority(priority?: string): RequestPriority {
    if (
      priority === RequestPriority.LOW ||
      priority === RequestPriority.NORMAL ||
      priority === RequestPriority.HIGH ||
      priority === RequestPriority.CRITICAL
    ) {
      return priority;
    }
    return RequestPriority.NORMAL;
  }

  private parseSource(source?: string): RequestSource {
    if (
      source === RequestSource.CLI || source === RequestSource.FILE || source === RequestSource.INTERACTIVE ||
      source === RequestSource.TUI
    ) {
      return source as RequestSource;
    }
    return RequestSource.CLI;
  }

  private async findFilename(id: string): Promise<string | null> {
    const list = await this.list();
    const found = list.find((e) => e.trace_id === id || e.trace_id.startsWith(id) || e.filename === id);
    return found ? found.filename : null;
  }
}
