/**
 * Public release lookup for the plugin's own update action.
 *
 * The repository is public, so the browser can read its release metadata
 * without a token. The action installs the release's npm tarball URL rather
 * than a Git spec: the Host's Git preflight has a fixed five-second bound and
 * a slow GitHub connection must not turn an otherwise valid update into a
 * failure. The tarball is the same package that `npm pack` produced and keeps
 * the normal `package/` layout pnpm expects.
 */

export const UPDATE_REPOSITORY = 'bayuefeiyu/model-spokesperson';
export const UPDATE_REPO_URL = `https://github.com/${UPDATE_REPOSITORY}`;
export const UPDATE_PACKAGE = '@dsh-plugins/model-spokesperson';
const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100`;
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_MS = 5 * 60_000;

export interface LatestRelease {
  readonly version: string;
  readonly tag: string;
  readonly htmlUrl: string;
  readonly assetName: string;
  readonly assetUrl: string;
  readonly checkedAt: number;
}

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

export type UpdateCheckFailure = 'network' | 'timeout' | 'http' | 'rate-limit' | 'empty' | 'invalid';

export class UpdateCheckError extends Error {
  constructor(readonly kind: UpdateCheckFailure, message: string) {
    super(message);
    this.name = 'UpdateCheckError';
  }
}

/** Parse an exact `vX.Y.Z` or `X.Y.Z` version, including an optional prerelease suffix. */
export function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split('.').map(part => /^\d+$/.test(part) ? Number(part) : part)
      : [],
  };
}

function compareIdentifier(left: string | number, right: string | number): number {
  const leftNumber = typeof left === 'number';
  const rightNumber = typeof right === 'number';
  if (leftNumber && rightNumber) return left - right;
  if (leftNumber) return -1;
  if (rightNumber) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Semver precedence for exact versions; unparseable values compare equal. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const order = compareIdentifier(leftPart, rightPart);
    if (order !== 0) return order;
  }
  return 0;
}

export function isNewer(current: string, candidate: string): boolean {
  return compareVersions(candidate, current) > 0;
}

function assetUrlOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return;
    return url.href;
  } catch {
    return;
  }
}

interface ReleaseCandidate {
  readonly version: string;
  readonly tag: string;
  readonly htmlUrl: string;
  readonly assetName: string;
  readonly assetUrl: string;
}

function releaseCandidates(data: unknown): ReleaseCandidate[] {
  if (!Array.isArray(data)) return [];
  const candidates: ReleaseCandidate[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const release = item as Record<string, unknown>;
    if (release.draft === true) continue;
    const tag = typeof release.tag_name === 'string' ? release.tag_name : undefined;
    const parsed = tag === undefined ? undefined : parseVersion(tag);
    if (tag === undefined || parsed === undefined || parsed.prerelease.length > 0) continue;
    const version = tag.replace(/^v/i, '');
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const assetsOf = assets.filter((asset): asset is Record<string, unknown> => typeof asset === 'object' && asset !== null);
    const expected = `dsh-plugins-model-spokesperson-${version}.tgz`;
    const chosen = assetsOf.find(asset => asset.name === expected && assetUrlOf(asset.browser_download_url) !== undefined)
      ?? assetsOf.find(asset => typeof asset.name === 'string' && asset.name.endsWith('.tgz') && assetUrlOf(asset.browser_download_url) !== undefined);
    if (chosen === undefined) continue;
    const assetName = typeof chosen.name === 'string' ? chosen.name : expected;
    const assetUrl = assetUrlOf(chosen.browser_download_url);
    if (assetUrl === undefined) continue;
    candidates.push({
      version,
      tag,
      htmlUrl: typeof release.html_url === 'string' ? release.html_url : `${UPDATE_REPO_URL}/releases/tag/${encodeURIComponent(tag)}`,
      assetName,
      assetUrl,
    });
  }
  return candidates;
}

/** The highest stable release that carries an installable tarball asset. */
export function latestRelease(data: unknown): LatestRelease | undefined {
  const candidates = releaseCandidates(data);
  let best: ReleaseCandidate | undefined;
  for (const candidate of candidates) {
    if (best === undefined || compareVersions(candidate.version, best.version) > 0) best = candidate;
  }
  if (best === undefined) return;
  return { ...best, checkedAt: Date.now() };
}

let cached: { release: LatestRelease; at: number } | undefined;

export function resetUpdateCache() {
  cached = undefined;
}

export interface FetchLatestOptions {
  readonly force?: boolean;
  readonly fetcher?: typeof fetch;
}

/**
 * Read the highest stable release with a package tarball from GitHub.
 *
 * The update action runs in the browser, so this deliberately has no token or
 * host route: a public repository needs neither. A 10-second bound keeps a
 * blocked network from leaving the detail action spinning.
 */
export async function fetchLatestRelease(options: FetchLatestOptions = {}): Promise<LatestRelease> {
  if (!options.force && cached !== undefined && Date.now() - cached.at < CACHE_MS) return cached.release;
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new UpdateCheckError('network', '当前环境不支持检查更新。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new UpdateCheckError('timeout', '检查更新超时，请稍后重试。');
    throw new UpdateCheckError('network', '无法连接 GitHub，请检查网络后重试。');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) throw new UpdateCheckError('rate-limit', 'GitHub 检查次数暂时受限，请稍后重试。');
    if (response.status === 404) throw new UpdateCheckError('http', 'GitHub 仓库或发布不可用。');
    throw new UpdateCheckError('http', `GitHub 返回 ${response.status}，请稍后重试。`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new UpdateCheckError('http', 'GitHub 返回了无法读取的发布数据。');
  }
  const release = latestRelease(data);
  if (release === undefined) throw new UpdateCheckError('empty', '没有找到带安装包的稳定版本。');
  cached = { release, at: Date.now() };
  return release;
}
