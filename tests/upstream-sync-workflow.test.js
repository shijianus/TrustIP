// The upstream sync workflow, executed rather than eyeballed.
// Its merge logic lives inside .github/workflows/sync.yml — one place, run by
// the schedule — so this test pulls the step's `run:` block out of the YAML and
// runs it the way the runner does (`bash --noprofile --norc -eo pipefail`)
// against throwaway git repositories: no network, no GitHub. `gh` is a stub
// that records every call and answers `gh api` from JSON fixtures piped through
// the script's own `--jq` filter, so the issue / PR matching is really run.
// Git is hermetic: no global or system config reaches the script.
//
// What is pinned: dev and main are never pushed — a clean merge goes to the
// bot branch sync/upstream-<sha12> and a PR; a conflict is one tracking issue,
// found by marker and bot author, never by title; anything that is the
// workflow breaking (merge-tree error, rejected push, failed API call) is red;
// and nothing upstream controls (path names) reaches the log or escapes the
// issue's code block. Plus the YAML-level invariants the script relies on.

import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

const WORKFLOW = join(import.meta.dirname, '..', '.github', 'workflows', 'sync.yml');
const STEP = 'Merge upstream into dev, or file the conflicts';
const BOT = 'github-actions[bot]';
const MARKER = '<!-- upstream-sync-blocked -->';
const REPO = 'test/repo';

// Every `run: |` block in the workflow, de-indented, keyed by its step name.
// The dedent is measured off each block's first body line, so reformatting the
// YAML cannot silently hand this test an empty or half a script to run.
const runBlocks = () => {
    const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
    const blocks = [];
    let name = null;
    lines.forEach((line, at) => {
        const named = line.match(/^\s*- name:\s*(.+)$/);
        if (named) name = named[1].trim();
        if (!/^\s*run:/.test(line)) return;
        assert.equal(line.trim(), 'run: |', `step "${name}" no longer uses a \`run: |\` block`);
        const first = lines.slice(at + 1).find((l) => l.trim() !== '');
        assert.ok(first, `step "${name}" has an empty \`run: |\` block`);
        const indent = first.search(/\S/);
        const body = [];
        for (let i = at + 1; i < lines.length; i += 1) {
            if (lines[i].trim() !== '' && lines[i].search(/\S/) < indent) break;
            body.push(lines[i].slice(indent));
        }
        blocks.push({ name, script: body.join('\n') });
    });
    return blocks;
};

const mergeScript = () => {
    const step = runBlocks().find((b) => b.name === STEP);
    assert.ok(step, `sync.yml has no step named "${STEP}"`);
    const count = step.script.split('\n').length;
    assert.ok(count > 100, `extracted only ${count} lines — the step moved or was reformatted`);
    return step.script;
};

const root = mkdtempSync(join(tmpdir(), 'upstream-sync-'));

// No developer config (commit.gpgsign, hooksPath, templates) leaks in.
const ENV = {
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    HOME: root,
    LANG: 'C',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
};

const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@local', ...args], {
        cwd,
        env: ENV,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
const sha = (repo, rev) => git(repo, 'rev-parse', rev).trim();

before(() => {
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), String.raw`#!/bin/bash
set -u
n=$(( $(wc -l < "$GH_CALLS") + 1 ))
printf '%s\n' "$*" >> "$GH_CALLS"
if [ "$1" = api ]; then
  if [ -n "${'${GH_API_FAIL:-}'}" ]; then echo 'gh: HTTP 502: Bad Gateway' >&2; exit 1; fi
  jqf=""; path=""; prev=""
  for a in "$@"; do
    [ "$prev" = --jq ] && jqf=$a
    case "$a" in repos/*) path=$a ;; esac
    prev=$a
  done
  case "$path" in
    */issues\?*) fx=$GH_ISSUES ;;
    */pulls\?*) fx=$GH_PULLS ;;
    *) echo "stub: unexpected api $path" >&2; exit 2 ;;
  esac
  # A fixture is an array of pages; --paginate applies --jq page by page, as gh does.
  pages=$(jq length "$fx")
  for ((i = 0; i < pages; i++)); do jq -c ".[$i]" "$fx" | jq -r "$jqf" || exit 3; done
  exit 0
fi
prev=""
for a in "$@"; do [ "$prev" = --body-file ] && cp "$a" "$GH_BODIES/$n.md"; prev=$a; done
case "$1 $2" in
  "pr create") echo "https://github.com/$GH_REPO/pull/99" ;;
  "issue create") echo "https://github.com/$GH_REPO/issues/100" ;;
esac
exit 0
`, { mode: 0o755 });
});

// A bare repo with `main` at `rev` — what the workflow reads as UPSTREAM_URL.
const upstreamRepo = (seed, rev, name) => {
    const bare = join(root, `up-${name}.git`);
    git(root, 'init', '-q', '--bare', bare);
    git(seed, 'push', '-q', bare, `${rev}:refs/heads/main`);
    return bare;
};

// The target ("origin"): `dev` at `rev`, HEAD on it, and a pre-receive hook
// that records every pushed ref — and rejects them all when `reject` exists.
const targetRepo = (seed, rev, name) => {
    const bare = join(root, `tgt-${name}.git`);
    git(root, 'init', '-q', '--bare', bare);
    git(seed, 'push', '-q', bare, `${rev}:refs/heads/dev`, `${rev}:refs/heads/main`);
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/dev');
    writeFileSync(join(bare, 'hooks', 'pre-receive'), [
        '#!/bin/sh',
        'while read old new ref; do echo "$ref" >> pushes.log; done',
        'if [ -e reject ]; then echo "rejected by test" >&2; exit 1; fi',
        '',
    ].join('\n'), { mode: 0o755 });
    return bare;
};

const issue = (number, extra = {}) => ({
    number,
    title: 'Upstream sync is blocked',
    user: { login: BOT },
    body: `${MARKER}\n\nold list`,
    ...extra,
});
const pull = (number, ref, extra = {}) => ({
    number,
    title: `Merge upstream main into dev`,
    user: { login: BOT },
    head: { ref, repo: { full_name: REPO } },
    base: { ref: 'dev' },
    ...extra,
});

const runMerge = ({ upstream, dev, issues = [[]], pulls = [[]], apiFail = false }) => {
    const id = Math.random().toString(36).slice(2);
    const work = join(root, `work-${id}`);
    const out = join(root, `out-${id}`);
    const bodies = join(out, 'bodies');
    mkdirSync(bodies, { recursive: true });
    execFileSync('git', ['clone', '-q', '--no-tags', dev, work], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    const calls = join(out, 'gh-calls.txt');
    writeFileSync(calls, '');
    writeFileSync(join(out, 'issues.json'), JSON.stringify(issues));
    writeFileSync(join(out, 'pulls.json'), JSON.stringify(pulls));
    const script = join(out, 'step.sh');
    writeFileSync(script, mergeScript());
    const pushLog = join(dev, 'pushes.log');
    const pushesBefore = existsSync(pushLog) ? readFileSync(pushLog, 'utf8') : '';

    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
        cwd: work,
        encoding: 'utf8',
        env: {
            ...ENV,
            UPSTREAM_URL: upstream,
            UPSTREAM_BRANCH: 'main',
            TARGET_BRANCH: 'dev',
            GH_REPO: REPO,
            GH_TOKEN: 'stub-token',
            GITHUB_STEP_SUMMARY: join(out, 'summary.txt'),
            GH_CALLS: calls,
            GH_BODIES: bodies,
            GH_ISSUES: join(out, 'issues.json'),
            GH_PULLS: join(out, 'pulls.json'),
            ...(apiFail ? { GH_API_FAIL: '1' } : {}),
        },
    });

    const ghCalls = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
    const pushes = (existsSync(pushLog) ? readFileSync(pushLog, 'utf8') : '')
        .slice(pushesBefore.length).trim().split('\n').filter(Boolean);
    const body = (n) => readFileSync(join(bodies, `${n}.md`), 'utf8');
    return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        ghCalls,
        writes: ghCalls.filter((c) => !c.startsWith('api ')),
        // The body of the first call matching `re`, by its 1-based call number.
        bodyOf: (re) => body(ghCalls.findIndex((c) => re.test(c)) + 1),
        hasBodies: () => readdirSync(bodies).length > 0,
        pushes,
        tip: (ref) => sha(dev, ref),
    };
};

describe('upstream sync workflow script', () => {
    const seed = join(root, 'seed');
    git(root, 'init', '-q', '-b', 'main', seed);
    const commit = (files, message, remove = []) => {
        for (const [name, text] of Object.entries(files)) {
            mkdirSync(join(seed, name, '..'), { recursive: true });
            writeFileSync(join(seed, name), text);
        }
        if (remove.length) git(seed, 'rm', '-q', ...remove);
        git(seed, 'add', '-A');
        git(seed, 'commit', '-qm', message);
        return sha(seed, 'HEAD');
    };
    const from = (rev) => git(seed, 'checkout', '-q', '--detach', rev);

    const base = commit({ 'shared.txt': 'base\n' }, 'shared base');
    // The fork's own work, which the sync must never lose.
    const forkTip = commit({ 'shared.txt': 'fork wording\n', 'fork-only.txt': 'ours\n' }, 'fork edits shared');

    from(base);
    const conflictUp = upstreamRepo(seed, commit({ 'shared.txt': 'upstream wording\n' }, 'upstream edits the same line'), 'conflict');
    from(base);
    const cleanTip = commit({ 'NOVEL.md': 'the fork never had this\n', 'package.json': '{}\n' }, 'upstream adds files nobody else touched');
    const cleanUp = upstreamRepo(seed, cleanTip, 'clean');
    const cleanShort = cleanTip.slice(0, 12);
    const syncBranch = `sync/upstream-${cleanShort}`;
    const syncedUp = upstreamRepo(seed, base, 'synced');
    from(base);
    const workflowUp = upstreamRepo(seed, commit({ '.github/workflows/new.yml': 'on: push\n' }, 'upstream adds a workflow'), 'workflow');

    git(seed, 'checkout', '-q', '--orphan', 'unrelated');
    git(seed, 'rm', '-rqf', '.');
    const unrelatedUp = upstreamRepo(seed, commit({ 'other.txt': 'no common root\n' }, 'unrelated root'), 'unrelated');

    // Path names upstream partly controls: fence breakers, a newline that would
    // start a workflow command, and markup that would render outside a code block.
    const hostile = ['```', '````', 'evil\n::warning::INJECTED', '@octocat <img src=x>.md'];
    from(base);
    const hostileBase = commit(Object.fromEntries(hostile.map((p) => [p, 'base\n'])), 'hostile names');
    const hostileFork = commit(Object.fromEntries(hostile.map((p) => [p, 'fork\n'])), 'fork edits them');
    from(hostileBase);
    const hostileUp = upstreamRepo(seed, commit(Object.fromEntries(hostile.map((p) => [p, 'upstream\n'])), 'upstream edits them'), 'hostile');

    // 400 conflicts with long names: far past GitHub's 65,536-character body limit uncapped.
    const many = Array.from({ length: 400 }, (_, i) => `many/${String(i).padStart(3, '0')}-${'x'.repeat(200)}.txt`);
    from(base);
    const manyBase = commit(Object.fromEntries(many.map((p) => [p, 'base\n'])), 'many files');
    const manyFork = commit(Object.fromEntries(many.map((p) => [p, 'fork\n'])), 'fork edits many');
    from(manyBase);
    const manyUp = upstreamRepo(seed, commit(Object.fromEntries(many.map((p) => [p, 'upstream\n'])), 'upstream edits many'), 'many');

    it('does nothing at all when dev already carries upstream', () => {
        const run = runMerge({ upstream: syncedUp, dev: targetRepo(seed, forkTip, 'synced') });
        assert.equal(run.status, 0, run.out);
        assert.match(run.out, /nothing to sync/);
        assert.deepEqual(run.writes, [], 'a no-op writes nothing');
        assert.deepEqual(run.pushes, []);
    });

    it('closes a leftover tracking issue and sync PR once dev carries upstream', () => {
        const run = runMerge({
            upstream: syncedUp,
            dev: targetRepo(seed, forkTip, 'stale'),
            issues: [[issue(42)]],
            pulls: [[pull(5, 'sync/upstream-0123456789ab')]],
        });
        assert.equal(run.status, 0, run.out);
        assert.deepEqual(run.writes.map((c) => c.split(' ').slice(0, 3).join(' ')), ['issue close 42', 'pr close 5']);
        assert.deepEqual(run.pushes, []);
    });

    it('puts a clean merge on the bot branch and opens a PR — dev is not touched', () => {
        const dev = targetRepo(seed, forkTip, 'clean');
        const run = runMerge({ upstream: cleanUp, dev });
        assert.equal(run.status, 0, run.out);
        assert.deepEqual(run.pushes, [`refs/heads/${syncBranch}`], 'the bot branch is the only ref written');
        assert.equal(run.tip('dev'), forkTip, 'dev is untouched');
        assert.equal(run.tip('main'), forkTip, 'main is untouched');

        const merge = run.tip(syncBranch);
        assert.equal(git(dev, 'log', '-1', '--format=%s', merge).trim(), `Merge upstream main (${cleanShort}) into dev`);
        assert.deepEqual(git(dev, 'log', '-1', '--format=%P', merge).trim().split(' '), [forkTip, cleanTip],
            'fork history first, upstream second: nothing rewritten');

        assert.equal(run.writes.length, 1, run.ghCalls.join('\n'));
        assert.match(run.writes[0], new RegExp(`^pr create --base dev --head ${syncBranch} `));
        const body = run.bodyOf(/^pr create /);
        assert.match(body, /CI has not run on this PR/);
        assert.match(body, /close and reopen this PR/);
        assert.match(body, /not squash/);
        assert.match(body, /`package\.json`/, 'a change to the build is called out');
    });

    it('keeps its own sync PR current and ignores look-alikes', () => {
        const run = runMerge({
            upstream: cleanUp,
            dev: targetRepo(seed, forkTip, 'lookalike'),
            issues: [[issue(42)]],
            pulls: [[
                // A fork's PR with the very branch name, and a same-titled PR by someone else.
                pull(13, syncBranch, { user: { login: 'mallory' }, head: { ref: syncBranch, repo: { full_name: 'mallory/repo' } } }),
                pull(14, 'feature', { user: { login: 'mallory' } }),
                // A maintainer's own branch under the bot's prefix is not the bot's to close.
                pull(10, 'sync/upstream-feedfacecafe', { user: { login: 'shijianus' } }),
                pull(11, 'sync/upstream-0123456789ab'),
            ], [pull(12, syncBranch)]],
        });
        assert.equal(run.status, 0, run.out);
        assert.deepEqual(run.writes.map((c) => c.split(' ').slice(0, 3).join(' ')),
            ['pr edit 12', 'pr close 11', 'issue close 42']);
    });

    it('does not re-push a bot branch that already carries the merge', () => {
        const dev = targetRepo(seed, forkTip, 'rerun');
        const first = runMerge({ upstream: cleanUp, dev });
        assert.equal(first.status, 0, first.out);
        const tip = first.tip(syncBranch);
        const second = runMerge({ upstream: cleanUp, dev, pulls: [[pull(12, syncBranch)]] });
        assert.equal(second.status, 0, second.out);
        assert.deepEqual(second.pushes, []);
        assert.equal(second.tip(syncBranch), tip);
        assert.match(second.writes[0], /^pr edit 12 /);
    });

    it('never overwrites a person\'s commits on the bot branch', () => {
        const dev = targetRepo(seed, forkTip, 'human');
        assert.equal(runMerge({ upstream: cleanUp, dev }).status, 0);
        const fixer = join(root, 'fixer');
        rmSync(fixer, { recursive: true, force: true });
        execFileSync('git', ['clone', '-q', '-b', syncBranch, dev, fixer], { env: ENV, stdio: 'ignore' });
        writeFileSync(join(fixer, 'fix.txt'), 'review follow-up\n');
        git(fixer, 'add', '-A');
        git(fixer, 'commit', '-qm', 'reviewer fix');
        git(fixer, 'push', '-q', 'origin', `HEAD:${syncBranch}`);
        const fixed = sha(fixer, 'HEAD');
        git(fixer, 'checkout', '-q', '--detach', forkTip);
        writeFileSync(join(fixer, 'dev-moved.txt'), 'x\n');
        git(fixer, 'add', '-A');
        git(fixer, 'commit', '-qm', 'dev moves on');
        git(fixer, 'push', '-q', 'origin', 'HEAD:dev');

        const run = runMerge({ upstream: cleanUp, dev, pulls: [[pull(12, syncBranch)]] });
        assert.equal(run.status, 0, run.out);
        assert.deepEqual(run.pushes, []);
        assert.equal(run.tip(syncBranch), fixed);
        assert.match(run.out, /::warning .*did not make/);
    });

    it('goes red, and opens no PR, when the push of the bot branch is rejected', () => {
        const dev = targetRepo(seed, forkTip, 'reject');
        writeFileSync(join(dev, 'reject'), '');
        const run = runMerge({ upstream: cleanUp, dev });
        assert.notEqual(run.status, 0, run.out);
        assert.deepEqual(run.writes, [], run.ghCalls.join('\n'));
        assert.equal(run.tip('dev'), forkTip);
    });

    it('files a conflicted merge as one issue and pushes nothing', () => {
        const run = runMerge({ upstream: conflictUp, dev: targetRepo(seed, forkTip, 'conflict') });
        assert.equal(run.status, 0, run.out);
        assert.deepEqual(run.pushes, [], 'a conflicted merge pushes nothing');
        assert.equal(run.writes.length, 1, run.ghCalls.join('\n'));
        assert.match(run.writes[0], /^issue create --title /);
        assert.match(run.out, /::warning/);

        const body = run.bodyOf(/^issue create /);
        assert.ok(body.startsWith(`${MARKER}\n`), 'the marker opens the body: it is what the next run matches on');
        assert.match(body, /conflicts in \*\*1\*\* file/);
        assert.match(body, /^shared\.txt$/m, 'the file to resolve is named');
        assert.match(body, /git checkout -b sync\//, 'and the way out is spelled out');
    });

    it('finds its issue by marker and bot author, never by title', () => {
        const run = runMerge({
            upstream: conflictUp,
            dev: targetRepo(seed, forkTip, 'decoy'),
            issues: [[
                issue(7, { user: { login: 'mallory' } }), // same title, same marker, older, filed by someone else
                issue(9, { pull_request: { url: 'x' } }), // a PR, which /issues also returns
                issue(50, { body: 'a bot issue about something else' }),
            ], [issue(42)]], // second page: --paginate has to be followed
        });
        assert.equal(run.status, 0, run.out);
        assert.match(run.ghCalls[0], /^api --paginate repos\/test\/repo\/issues\?/, 'the lookup runs before any write');
        assert.equal(run.writes.length, 1, run.ghCalls.join('\n'));
        assert.match(run.writes[0], /^issue edit 42 /);
    });

    it('goes red rather than filing a duplicate when the issue lookup fails', () => {
        const run = runMerge({ upstream: conflictUp, dev: targetRepo(seed, forkTip, 'apifail'), apiFail: true });
        assert.notEqual(run.status, 0, run.out);
        assert.deepEqual(run.writes, [], run.ghCalls.join('\n'));
    });

    it('keeps hostile path names out of the log and inside the code block', () => {
        const run = runMerge({ upstream: hostileUp, dev: targetRepo(seed, hostileFork, 'hostile') });
        assert.equal(run.status, 0, run.out);
        assert.doesNotMatch(run.out, /^::warning::INJECTED/m, 'no path reaches the log as a workflow command');
        assert.doesNotMatch(run.out, /octocat/);

        const body = run.bodyOf(/^issue create /);
        assert.match(body, /conflicts in \*\*4\*\* file/);
        const lines = body.split('\n');
        const open = lines.indexOf('`````');
        assert.notEqual(open, -1, 'the fence is longer than the longest backtick run in the list');
        const close = lines.indexOf('`````', open + 1);
        const list = lines.slice(open + 1, close);
        assert.deepEqual([...list].sort(), ['"evil\\n::warning::INJECTED"', '```', '````', '@octocat <img src=x>.md'].sort());
    });

    it('caps the issue body under GitHub\'s size limit', () => {
        const run = runMerge({ upstream: manyUp, dev: targetRepo(seed, manyFork, 'many') });
        assert.equal(run.status, 0, run.out);
        const body = run.bodyOf(/^issue create /);
        assert.ok(body.length < 65536, `body is ${body.length} characters`);
        assert.match(body, /conflicts in \*\*400\*\* file/);
        assert.match(body, /…and \d+ more/);
        assert.equal(body.split('\n').filter((l) => l === '```').length % 2, 0, 'every fence is closed');
    });

    it('files a clean merge that changes workflow files, which the token cannot push', () => {
        const run = runMerge({ upstream: workflowUp, dev: targetRepo(seed, forkTip, 'workflow') });
        assert.equal(run.status, 0, run.out);
        assert.deepEqual(run.pushes, []);
        assert.match(run.writes[0], /^issue create /);
        assert.match(run.bodyOf(/^issue create /), /^\.github\/workflows\/new\.yml$/m);
    });

    it('reports a merge that cannot even be computed as a broken workflow', () => {
        const run = runMerge({ upstream: unrelatedUp, dev: targetRepo(seed, forkTip, 'unrelated') });
        assert.notEqual(run.status, 0, 'an unmergeable upstream stays red');
        assert.match(run.out, /merge-tree .* failed \(exit 128\)/);
        assert.deepEqual(run.ghCalls, [], 'it is not a conflict, so it is not filed as one');
        assert.deepEqual(run.pushes, []);
    });
});

describe('upstream sync workflow definition', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');

    it('asks for exactly the permissions the script uses', () => {
        const block = yml.match(/^permissions:\n((?: {2}.*\n)+)/m);
        assert.ok(block, 'a top-level permissions block');
        const perms = block[1].trim().split('\n').map((l) => l.replace(/#.*/, '').trim());
        assert.deepEqual(perms.sort(), ['contents: write', 'issues: write', 'pull-requests: write']);
    });

    it('runs only on a schedule or by hand', () => {
        const on = yml.match(/^on:\n((?: {2}.*\n|\n)+?)(?=^\S)/m);
        assert.ok(on);
        const triggers = on[1].split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*/, ''));
        assert.deepEqual(triggers, ['schedule', 'workflow_dispatch']);
        assert.doesNotMatch(yml, /pull_request_target/);
    });

    it('never interpolates an expression into a script', () => {
        for (const { name, script } of runBlocks()) {
            assert.doesNotMatch(script, /\$\{\{/, `step "${name}" has \${{ }} inside run:`);
        }
    });

    it('pins every action by full commit SHA and keeps the token off disk', () => {
        const uses = [...yml.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
        assert.ok(uses.length > 0);
        for (const ref of uses) assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is not pinned by SHA`);
        assert.match(yml, /^\s+persist-credentials: false$/m);
    });

    it('queues runs instead of cancelling one mid-push', () => {
        assert.match(yml, /^concurrency:\n\s+group: upstream-sync\n\s+cancel-in-progress: false$/m);
    });

    it('pushes nothing but the sync branch', () => {
        const pushes = mergeScript().split('\n').filter((l) => /\bgit\s+push\b|origin_git\s+push\b/.test(l));
        assert.equal(pushes.length, 1, pushes.join('\n'));
        assert.match(pushes[0], /"\$commit:refs\/heads\/\$branch"$/);
        assert.match(mergeScript(), /^branch="sync\/upstream-\$short"$/m);
    });
});

after(() => {
    rmSync(root, { recursive: true, force: true });
});
