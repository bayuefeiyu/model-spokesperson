import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UpdateCheckError,
  compareVersions,
  fetchLatestRelease,
  isNewer,
  latestRelease,
  parseVersion,
  resetUpdateCache,
} from '../src/update.ts';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

function release(tag: string, options: { draft?: boolean; asset?: boolean; prerelease?: boolean } = {}) {
  const version = tag.replace(/^v/i, '');
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? true,
    html_url: `https://github.com/bayuefeiyu/model-spokesperson/releases/tag/${tag}`,
    assets: options.asset === false ? [] : [{
      name: `dsh-plugins-model-spokesperson-${version}.tgz`,
      browser_download_url: `https://github.com/bayuefeiyu/model-spokesperson/releases/download/${tag}/dsh-plugins-model-spokesperson-${version}.tgz`,
    }],
  };
}

test('semver comparison handles numeric order and prereleases', () => {
  assert.deepEqual(parseVersion('v0.2.3'), { major: 0, minor: 2, patch: 3, prerelease: [] });
  assert.equal(parseVersion('0.2'), undefined);
  assert.ok(compareVersions('0.2.10', '0.2.2') > 0);
  assert.ok(compareVersions('0.2.3', '0.2.3-rc.1') > 0);
  assert.ok(compareVersions('0.2.3-rc.2', '0.2.3-rc.1') > 0);
  assert.equal(compareVersions('0.2.3', 'v0.2.3'), 0);
  assert.equal(compareVersions('not-a-version', '0.2.3'), 0);
  assert.equal(isNewer('0.2.2', 'v0.2.3'), true);
  assert.equal(isNewer('0.2.3', 'v0.2.3'), false);
});

test('release selection ignores drafts, prerelease tags, and releases without a package tarball', () => {
  const selected = latestRelease([
    release('v0.2.2'),
    { ...release('v0.2.10'), draft: true },
    release('v0.3.0-rc.1'),
    release('v0.2.3', { asset: false }),
    release('nightly'),
  ]);
  assert.equal(selected?.version, '0.2.2');
  assert.equal(selected?.assetName, 'dsh-plugins-model-spokesperson-0.2.2.tgz');
  assert.equal(selected?.assetUrl, 'https://github.com/bayuefeiyu/model-spokesperson/releases/download/v0.2.2/dsh-plugins-model-spokesperson-0.2.2.tgz');
  assert.equal(latestRelease([release('v0.2.3', { asset: false })]), undefined);
});

test('fetching releases returns the highest stable release with a tarball, caches it, and a forced check refreshes it', async () => {
  resetUpdateCache();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return json([
      release('v0.2.10'),
      release('v0.2.2'),
      release('v0.3.0-rc.1'),
    ]);
  };
  const first = await fetchLatestRelease({ fetcher });
  assert.deepEqual(
    { version: first.version, tag: first.tag, assetName: first.assetName },
    {
      version: '0.2.10',
      tag: 'v0.2.10',
      assetName: 'dsh-plugins-model-spokesperson-0.2.10.tgz',
    },
  );
  await fetchLatestRelease({ fetcher });
  assert.equal(calls, 1, 'the second read uses the five-minute cache');
  await fetchLatestRelease({ fetcher, force: true });
  assert.equal(calls, 2, 'an explicit check bypasses the cache');
  resetUpdateCache();
});

test('GitHub failures become readable update-check errors', async () => {
  resetUpdateCache();
  await assert.rejects(
    fetchLatestRelease({ fetcher: async () => json({ message: 'rate limited' }, 403) }),
    (error: unknown) => error instanceof UpdateCheckError && error.kind === 'rate-limit',
  );
  await assert.rejects(
    fetchLatestRelease({ fetcher: async () => { throw new TypeError('offline'); } }),
    (error: unknown) => error instanceof UpdateCheckError && error.kind === 'network',
  );
  await assert.rejects(
    fetchLatestRelease({ fetcher: async () => json([release('v0.2.3', { asset: false })]) }),
    (error: unknown) => error instanceof UpdateCheckError && error.kind === 'empty',
  );
  resetUpdateCache();
});
