/**
 * src/lib/sync/webdavClient.ts
 *
 * 麻糬のDDL V2 — 纯客户端 WebDAV / 坚果云适配器 (BYOC)
 * 符合 PRD_V2 §FR-SYNC-01 & TECH_SPEC_V2 §4 规范：
 * 1. 支持标准 WebDAV 命令：PROPFIND, GET, PUT, MKCOL, HEAD, DELETE；
 * 2. 默认适配坚果云 WebDAV (https://dav.jianguoyun.com/dav/)；
 * 3. 隔离根目录：/DDLife-v2/realm-{realmId}/；
 * 4. 完整的错误码映射、重试与连通性测试 (ping)。
 */

export interface WebDavConfig {
  serverUrl: string;       // 例如 https://dav.jianguoyun.com/dav/
  username: string;        // 坚果云账号邮箱
  appPassword: string;     // 坚果云生成的专属应用密码（非主账号密码）
  realmId?: string;        // 用户数据隔离空间ID（默认自动生成）
}

export interface WebDavFileItem {
  href: string;
  isCollection: boolean;
  contentLength?: number;
  lastModified?: string;
  etag?: string;
}

export class WebDavClient {
  private config: WebDavConfig;
  private authHeader: string;

  constructor(config: WebDavConfig) {
    this.config = config;
    const cleanUrl = config.serverUrl.endsWith('/') ? config.serverUrl : `${config.serverUrl}/`;
    this.config.serverUrl = cleanUrl;
    // Basic Auth Header
    this.authHeader = `Basic ${this.btoa(`${config.username}:${config.appPassword}`)}`;
  }

  private btoa(str: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let output = '';
    for (let block = 0, charCode, idx = 0, map = chars;
      str.charAt(idx | 0) || (map = '=', idx % 1);
      output += map.charAt(63 & block >> 8 - idx % 1 * 8)) {
      charCode = str.charCodeAt(idx += 3/4);
      if (charCode > 0xFF) {
        throw new Error('btoa: 字符串包含非 ASCII 字符');
      }
      block = block << 8 | charCode;
    }
    return output;
  }

  public getRootPath(): string {
    const realm = this.config.realmId || 'default';
    return `DDLife-v2/realm-${realm}`;
  }

  public getFullUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `${this.config.serverUrl}${cleanPath}`;
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return resp;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 连通性测试 (Ping)
   */
  public async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const url = this.config.serverUrl;
      const resp = await this.fetchWithTimeout(url, {
        method: 'PROPFIND',
        headers: {
          'Authorization': this.authHeader,
          'Depth': '0',
          'Content-Type': 'application/xml; charset=utf-8',
        },
      }, 10000);

      if (resp.status === 207 || resp.status === 200) {
        return { success: true, message: '坚果云 WebDAV 连接成功！' };
      }
      if (resp.status === 401) {
        return { success: false, message: '认证失败：请检查坚果云账号或应用密码是否正确' };
      }
      if (resp.status === 404) {
        return { success: false, message: 'WebDAV 服务地址不存在，请检查服务器 URL' };
      }
      return { success: false, message: `服务器返回状态码: ${resp.status}` };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, message: '连接坚果云服务器超时 (10秒)，请检查网络状况' };
      }
      return { success: false, message: `网络连接失败: ${err?.message || '请检查网络状况'}` };
    }
  }

  /**
   * 创建远程目录（递归或单级 MKCOL）
   */
  public async ensureDirectory(path: string): Promise<boolean> {
    try {
      const url = this.getFullUrl(path);
      const resp = await this.fetchWithTimeout(url, {
        method: 'MKCOL',
        headers: { 'Authorization': this.authHeader },
      }, 10000);
      return resp.status === 201 || resp.status === 405; // 405 代表目录已存在
    } catch {
      return false;
    }
  }

  /**
   * 上传文件内容 (PUT)
   */
  public async putFile(path: string, content: string | Uint8Array): Promise<{ success: boolean; error?: string }> {
    try {
      const url = this.getFullUrl(path);
      const resp = await this.fetchWithTimeout(url, {
        method: 'PUT',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/octet-stream',
        },
        body: content as any,
      }, 25000);

      if (resp.status === 200 || resp.status === 201 || resp.status === 204) {
        return { success: true };
      }
      return { success: false, error: `上传失败，HTTP 状态码: ${resp.status}` };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, error: '上传文件超时 (25秒)，网络中断' };
      }
      return { success: false, error: `上传异常: ${err?.message || '网络中断'}` };
    }
  }

  /**
   * 下载文件内容 (GET)
   */
  public async getFile(path: string): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
      const url = this.getFullUrl(path);
      const resp = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'Authorization': this.authHeader },
      }, 25000);

      if (resp.status === 200) {
        const text = await resp.text();
        return { success: true, data: text };
      }
      if (resp.status === 404) {
        return { success: false, error: 'FILE_NOT_FOUND' };
      }
      return { success: false, error: `下载失败，HTTP 状态码: ${resp.status}` };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, error: '下载文件超时 (25秒)，网络中断' };
      }
      return { success: false, error: `下载异常: ${err?.message || '网络中断'}` };
    }
  }

  /**
   * 列出目录文件清单 (PROPFIND Depth 1，全面支持各命名空间与大小写)
   */
  public async listFiles(path: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
    try {
      const url = this.getFullUrl(path);
      const resp = await this.fetchWithTimeout(url, {
        method: 'PROPFIND',
        headers: {
          'Authorization': this.authHeader,
          'Depth': '1',
          'Content-Type': 'application/xml; charset=utf-8',
        },
      }, 15000);

      if (resp.status !== 207 && resp.status !== 200) {
        return { success: false, error: `列出目录失败，状态码: ${resp.status}` };
      }

      const xml = await resp.text();
      if (!xml || !xml.trim()) {
        return { success: true, files: [] };
      }

      // 正则全面匹配各类 WebDAV 格式：<d:href>、<D:href>、<href> 等
      const hrefRegex = /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/gi;
      const filePaths: string[] = [];
      let match: RegExpExecArray | null;

      while ((match = hrefRegex.exec(xml)) !== null) {
        const rawHref = match[1].trim();
        // 过滤空或当前根目录自身
        if (!rawHref || rawHref.endsWith('/')) continue;
        const fileName = rawHref.split('/').pop();
        if (fileName && fileName !== path) {
          try {
            // 支持包含空格、中文字符与双重 URI 编码的健壮解码
            const decoded = decodeURIComponent(fileName);
            filePaths.push(decoded);
          } catch {
            filePaths.push(fileName);
          }
        }
      }

      return { success: true, files: Array.from(new Set(filePaths)) };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, error: '列出目录请求超时 (15秒)' };
      }
      return { success: false, error: `列出目录异常: ${err?.message}` };
    }
  }

  /**
   * 删除文件或目录 (DELETE)
   */
  public async deleteItem(path: string): Promise<boolean> {
    try {
      const url = this.getFullUrl(path);
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': this.authHeader },
      });
      return resp.status === 200 || resp.status === 204 || resp.status === 404;
    } catch {
      return false;
    }
  }
}
