// The upstream sync workflow's merge logic, executed rather than eyeballed.
// That script lives inside .github/workflows/sync.yml — one place, run by the
// schedule — so this test pulls the step's `run:` block out of the YAML and
// drives it against throwaway git repositories: no network, no GitHub, and a
// `gh` stub that records the calls and answers the issue lookup.
//
// What is pinned is the behaviour that failed for eight straight days, plus the
// safety property that comes with it: a conflicted merge must never move dev,
// must never be reported as a broken workflow, and must never file a second
// issue for the same conflict.

import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

const WORKFLOW = join(import.meta.dirname, '..', '.github', 'workflows', 'sync.yml');
const BODY = join(mkdtempSync(join(tmpdir(), 'sync-body-')), 'last-issue-body.txt');

// The step's block scalar, de-indented. Located by the step's name, and the
// dedent measured off its first body line, so reformatting the YAML cannot
// silently hand this test an empty or half a script to run.
const mergeScript = () => {
    const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
    const stepAt = lines.findIndex((line) =>
        line.trim() === '- name: Merge upstream into dev, or file the conflicts');
    assert.notEqual(stepAt, -1, 'sync.yml has no step named "Merge upstream into dev, or file the conflicts"');
    const runAt = lines.findIndex((line, i) => i > stepAt && line.trim() === 'run: |');
    assert.notEqual(runAt, -1, 'that step no longer uses a `run: |` block');

    const first = lines.slice(runAt + 1).find((line) => line.trim() !== '');
    assert.ok(first, 'the `run: |` block is empty');
    const indent = first.search(/\S/);

    const body = [];
    for (let i = runAt + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim() !== '' && line.search(/\S/) < indent) break;
        body.push(line.slice(indent));
    }
    assert.ok(body.length > 30, `extracted only ${body.length} lines — the step moved or was reformatted`);
    return body.join('\n');
};

const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@local',
        '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

const root = mkdtempSync(join(tmpdir(), 'upstream-sync-'));
const calls = join(root, 'gh-calls.txt');

before(() => {
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), [
        '#!/bin/bash',
        `printf '%s\\n' "$*" >> ${JSON.stringify(calls)}`,
        // `gh api` is the open-issue lookup; the rest are the writes under test.
        'if [ "$1" = "api" ]; then if [ -n "${EXISTING_ISSUE:-}" ]; then echo "$EXISTING_ISSUE"; fi; exit 0; fi',
        'prev=""',
        'for a in "$@"; do',
        `  if [ "$prev" = "--body-file" ]; then cp "$a" ${JSON.stringify(BODY)}; fi`,
        '  prev="$a"',
        'done',
        'exit 0',
        '',
    ].join('\n'), { mode: 0o755 });
});

// A bare repo with `main` at `sha` — what the workflow reads as UPSTREAM_URL.
const upstreamRepo = (work, sha, name) => {
    const bare = join(root, `up-${name}.git`);
    git(root, 'init', '-q', '--bare', bare);
    git(work, 'push', '-q', bare, `${sha}:refs/heads/main`);
    return bare;
};

// A bare repo with `dev` at `sha` and HEAD pointing at it, so cloning gives a
// checked-out tree the way a runner's checkout does.
const targetRepo = (work, sha, name) => {
    const bare = join(root, `tgt-${name}.git`);
    git(root, 'init', '-q', '--bare', bare);
    git(work, 'push', '-q', bare, `${sha}:refs/heads/dev`);
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/dev');
    return bare;
};

const runMerge = ({ upstream, dev, existingIssue = '' }) => {
    const work = join(root, `work-${Math.random().toString(36).slice(2)}`);
    execFileSync('git', ['clone', '-q', '--no-tags', dev, work], { stdio: ['ignore', 'pipe', 'pipe'] });
    git(work, 'checkout', '-q', '-B', 'dev', 'origin/dev');
    writeFileSync(calls, '');
    rmSync(BODY, { force: true });

    const result = spawnSync('bash', ['-c', mergeScript()], {
        cwd: work,
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${join(root, 'bin')}:${process.env.PATH}`,
            UPSTREAM_URL: upstream,
            UPSTREAM_BRANCH: 'main',
            TARGET_BRANCH: 'dev',
            GH_TOKEN: 'stub',
            GITHUB_REPOSITORY: 'test/repo',
            GITHUB_STEP_SUMMARY: join(root, 'summary.txt'),
            EXISTING_ISSUE: existingIssue,
        },
    });

    const out = `${result.stdout}${result.stderr}`;
    const ghCalls = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
    return {
        status: result.status,
        out,
        ghCalls,
        issueCalls: ghCalls.filter((line) => line.startsWith('issue ')),
        devTip: git(dev, 'log', '-1', '--format=%H %s', 'dev').trim(),
        isAncestorOfDev: (sha) =>
            spawnSync('git', ['-C', dev, 'merge-base', '--is-ancestor', sha, 'dev']).status === 0,
    };
};

describe('upstream sync workflow script', () => {
    const seed = join(root, 'seed');
    git(root, 'init', '-q', seed);
    writeFileSync(join(seed, 'shared.txt'), 'base\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-qm', 'shared base');
    const base = git(seed, 'rev-parse', 'HEAD').trim();

    // The fork's own work, which the sync must never lose.
    writeFileSync(join(seed, 'shared.txt'), 'fork wording\n');
    writeFileSync(join(seed, 'fork-only.txt'), 'ours\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'fork edits shared');
    const forkTip = git(seed, 'rev-parse', 'HEAD').trim();

    const onBase = (branch) => {
        git(seed, 'checkout', '-q', '-B', branch, base);
        return branch;
    };

    onBase('up-conflict');
    writeFileSync(join(seed, 'shared.txt'), 'upstream wording\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'upstream edits the same line');
    const conflictUpstream = upstreamRepo(seed, git(seed, 'rev-parse', 'HEAD').trim(), 'conflict');

    onBase('up-clean');
    writeFileSync(join(seed, 'NOVEL.md'), 'the fork never had this\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'upstream adds a file nobody else touched');
    const cleanUpstream = upstreamRepo(seed, git(seed, 'rev-parse', 'HEAD').trim(), 'clean');

    const syncedUpstream = upstreamRepo(seed, base, 'synced');

    git(seed, 'checkout', '-q', '--orphan', 'up-unrelated');
    writeFileSync(join(seed, 'other.txt'), 'no common root\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'unrelated root');
    const unrelatedUpstream = upstreamRepo(seed, git(seed, 'rev-parse', 'HEAD').trim(), 'unrelated');

    it('does nothing at all when dev already carries upstream', () => {
        const run = runMerge({ upstream: syncedUpstream, dev: targetRepo(seed, forkTip, 'synced') });
        assert.equal(run.status, 0, run.out);
        assert.match(run.out, /nothing to sync/);
        assert.deepEqual(run.ghCalls, [], 'a no-op files nothing');
    });

    it('lands a clean merge on dev, named for the branch it lands on', () => {
        const short = git(cleanUpstream, 'rev-parse', '--short', 'main').trim();
        const run = runMerge({ upstream: cleanUpstream, dev: targetRepo(seed, forkTip, 'clean') });
        assert.equal(run.status, 0, run.out);
        assert.match(run.devTip, new RegExp(`Merge upstream main \\(${short}\\) into dev$`));
        assert.deepEqual(run.ghCalls, [], 'a landed merge files nothing');
    });

    it('never rewrites dev: the merge sits on top of the commits it started with', () => {
        const run = runMerge({ upstream: cleanUpstream, dev: targetRepo(seed, forkTip, 'ff') });
        assert.equal(run.status, 0, run.out);
        assert.ok(run.isAncestorOfDev(forkTip), 'fork history must survive the sync');
        assert.ok(run.isAncestorOfDev(git(cleanUpstream, 'rev-parse', 'main').trim()));
    });

    it('files a conflicted merge as an issue and leaves dev exactly where it was', () => {
        const dev = targetRepo(seed, forkTip, 'conflict');
        const before = git(dev, 'rev-parse', 'dev').trim();
        const run = runMerge({ upstream: conflictUpstream, dev });
        assert.equal(run.status, 0, run.out);
        assert.equal(git(dev, 'rev-parse', 'dev').trim(), before, 'a conflicted merge must not move dev');
        assert.equal(run.issueCalls.length, 1, run.ghCalls.join('\n'));
        assert.match(run.issueCalls[0], /^issue create /);
        assert.match(run.out, /::warning/);

        const body = readFileSync(BODY, 'utf8');
        assert.match(body, /conflicts in \*\*1\*\* file/);
        assert.match(body, /^shared\.txt$/m, 'the file to resolve is named');
        assert.match(body, /git checkout -b sync\//, 'and the way out is spelled out');
    });

    it('updates the one open issue rather than filing a second for the same conflict', () => {
        const run = runMerge({ upstream: conflictUpstream, dev: targetRepo(seed, forkTip, 'dupe'), existingIssue: '42' });
        assert.equal(run.status, 0, run.out);
        assert.match(run.ghCalls[0], /^api /, 'the lookup runs before any write');
        assert.equal(run.issueCalls.length, 1, run.ghCalls.join('\n'));
        assert.match(run.issueCalls[0], /^issue edit 42 /);
    });

    it('reports a merge that failed with nothing to resolve as a broken workflow', () => {
        const dev = targetRepo(seed, forkTip, 'unrelated');
        const before = git(dev, 'rev-parse', 'dev').trim();
        const run = runMerge({ upstream: unrelatedUpstream, dev });
        assert.notEqual(run.status, 0, 'an unmergeable upstream stays red');
        assert.match(run.out, /no conflicted files/);
        assert.deepEqual(run.ghCalls, [], 'it is not a conflict, so it is not filed as one');
        assert.equal(git(dev, 'rev-parse', 'dev').trim(), before);
    });
});

after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(join(BODY, '..'), { recursive: true, force: true });
});
