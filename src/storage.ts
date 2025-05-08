import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SERVER_APPDATA_DIRS } from "./constants.js";

/** Ensure that the directory for a file exists */
const ensureDir = (file: string) =>
  mkdir(path.dirname(file), { recursive: true });

/** Convert a URL or string into a storage key */
const urlToKey = (url: URL | string) =>
  createHash("sha256").update(url.toString()).digest("hex");

interface CachedFileOptions {
  dir?: string;
}

export class CachedFile {
  public readonly file: string;
  public readonly url: URL | string;

  static forURL(url: URL | string, options?: CachedFileOptions) {
    return new CachedFile(url, options);
  }

  constructor(url: URL | string, options?: CachedFileOptions) {
    this.file = path.join(
      path.resolve(options?.dir ?? SERVER_APPDATA_DIRS.cache),
      urlToKey(url)
    );
    this.url = url;
    this.refresh = this.refresh.bind(this);
    this.resolve = this.resolve.bind(this);
    this.write = this.write.bind(this);
  }

  async refresh(): Promise<this> {
    const resp = await fetch(this.url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${this.url}: ${resp.statusText}`);
    }
    await ensureDir(this.file);
    await writeFile(this.file, Buffer.from(await resp.arrayBuffer()));
    return this;
  }

  async resolve(): Promise<this> {
    await ensureDir(this.file);
    try {
      await access(this.file, constants.R_OK);
      return this;
    } catch {
      await this.refresh();
      await access(this.file, constants.R_OK);
      return this;
    }
  }

  protected async write(data: Buffer): Promise<void> {
    await ensureDir(this.file);
    await writeFile(this.file, data);
  }
}
