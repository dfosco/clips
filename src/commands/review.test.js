import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const tempDirs = [];
let payloadNumber = 0;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function workspace({ collaboration = false, lane_pr_mode = 'none' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-reviews-'));
  tempDirs.push(root);
  git(root, 'init', '--quiet', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'config', 'user.name', 'Review Test');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'CR-001.md'), '# Change request\n\nPinned request body.\n');
  fs.writeFileSync(path.join(root, 'source.txt'), 'base\n');
  git(root, 'add', 'docs/CR-001.md', 'source.txt');
  git(root, 'commit', '--quiet', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  git(root, 'switch', '--quiet', '-c', 'feat/lane-review-delivery');
  fs.writeFileSync(path.join(root, 'source.txt'), 'feature\n');
  git(root, 'commit', '--quiet', '-am', 'feature');
  const head = git(root, 'rev-parse', 'HEAD');
  fs.mkdirSync(path.join(root, '.clips', 'db'), { recursive: true });
  fs.mkdirSync(path.join(root, '.clips', 'records', 'cr'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration, lane_pr_mode }));
  const env = {
    ...process.env,
    HOME: path.join(root, 'home'),
    LANES_HOME: path.join(root, 'home', '.lanes'),
    CLIPS_HOME: path.join(root, 'home', '.clips'),
    CLIPS_SWITCH_INIT: '1',
    LANES_SWITCH_INIT: '1',
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  return { root, env, base, head };
}

function invoke(root, env, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: root, env, encoding: 'utf8' });
}

function run(root, env, ...args) {
  const result = invoke(root, env, ...args);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function fails(root, env, ...args) {
  const result = invoke(root, env, ...args);
  expect(result.status).not.toBe(0);
  return `${result.stdout}\n${result.stderr}`;
}

function makeGoal(root, env, { lane_id, title = 'Goal', acceptance_owner = 'reviewer' } = {}) {
  const payload = { title, description: 'Implement a pinned change.', acceptance_owner, ...(lane_id ? { lane_id } : {}) };
  run(root, env, 'goal', 'create', JSON.stringify(payload));
  run(root, env, 'task', 'create', '#g1', JSON.stringify({
    title: 'Task obligation', description: 'Keep this child request under review.', acceptance_owner,
  }));
  const added = run(root, env, 'attachment', 'add', '#g1', JSON.stringify({
    type: 'markdown', path: 'docs/CR-001.md', title: 'CR-001: Change request', purpose: 'cr',
  }));
  return added.attachment.id;
}

function requestPayload({ attachment_id, base, head, covers, reviewer = 'reviewer' }) {
  return { attachment_id, reviewer, candidate: { base, head }, ...(covers ? { covers } : {}),
    summary: 'Review the feature candidate.', validation: { command: 'npm test', status: 'passed' } };
}

function request(root, env, input, ref = '#g1') {
  return run(root, env, 'review', 'request', ref, '--file', payloadFile(root, input));
}

function payloadFile(root, payload) {
  const file = path.join(root, `payload-${payloadNumber++}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

function decidePayload(review, extra = {}) {
  return { decision: 'approved', actor: 'reviewer', candidate: review.candidate, comment: 'Reviewed exact candidate.',
    expected_revision: review.revision, ...extra };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('durable review requests', () => {
  it('pins readable CR content, candidate commits, Goal and required Task obligations; metadata notes do not stale it', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    expect(review).toMatchObject({ status: 'awaiting_review', revision: 1, stale: false,
      candidate: { base, head, base_ref: 'main', head_ref: 'feat/lane-review-delivery' }, covers: ['#g001'] });
    expect(run(root, env, 'review', 'show', review.id, '--json').coverage_snapshots[0].obligations.map(({ ref }) => ref))
      .toEqual(['#g001', '#g001#t01']);
    const show = run(root, env, 'review', 'show', review.id, '--json');
    expect(show.attachment).toMatchObject({ purpose: 'cr', content: '# Change request\n\nPinned request body.\n',
      content_identity: { sha256: show.content_identity.sha256 } });
    expect(run(root, env, 'review', 'list', '--json').reviews).toHaveLength(1);

    run(root, env, 'task', 'update', '#g1#t1', JSON.stringify({ owner: 'new-owner', record: 'Updated result evidence.' }));
    expect(run(root, env, 'review', 'show', review.id, '--json')).toMatchObject({ stale: false, status: 'awaiting_review' });
    run(root, env, 'task', 'update', '#g1#t1', JSON.stringify({ acceptance_owner: 'different-reviewer' }));
    expect(run(root, env, 'review', 'show', review.id, '--json').stale_reasons).toContain('contract_changed:#g001#t01');
  });

  it('rejects overlapping Goal and Task coverage, remote-only CRs, and out-of-Lane coverage', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    fails(root, env, 'review', 'request', '#g1', '--file', payloadFile(root, requestPayload({ attachment_id, base, head, covers: ['#g1', '#g1#t1'] })));
    const remote = run(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'github_pr', url: 'https://github.com/acme/app/pull/5', purpose: 'cr',
    })).attachment;
    fails(root, env, 'review', 'request', '#g1', '--file', payloadFile(root, requestPayload({ attachment_id: remote.id, base, head })));

    run(root, env, 'lane', 'create', JSON.stringify({ title: 'First lane', product_goals: ['One'] }));
    run(root, env, 'goal', 'create', JSON.stringify({ title: 'Other Goal', description: 'Outside lane' }));
    const laneAttachment = run(root, env, 'attachment', 'add', '#l1', JSON.stringify({
      type: 'markdown', path: 'docs/CR-001.md', purpose: 'cr',
    })).attachment;
    fails(root, env, 'review', 'request', '#l1', '--file', payloadFile(root, requestPayload({
      attachment_id: laneAttachment.id, base, head, covers: ['#g2'],
    })));
  });

  it('requires explicit Lane covers and supersedes overlapping child reviews without inheriting approval', () => {
    const { root, env, base, head } = workspace();
    run(root, env, 'lane', 'create', JSON.stringify({ title: 'Lane', product_goals: ['Selected goals'] }));
    const attachment_id = makeGoal(root, env, { lane_id: 'l1' });
    fails(root, env, 'review', 'request', '#l1', '--file', payloadFile(root, requestPayload({ attachment_id, base, head })));
    const child = request(root, env, requestPayload({ attachment_id, base, head }), '#g1');
    run(root, env, 'review', 'decide', child.id, '--file', payloadFile(root, decidePayload(child)));
    const laneAttachment = run(root, env, 'attachment', 'add', '#l1', JSON.stringify({
      type: 'markdown', path: 'docs/CR-001.md', purpose: 'cr',
    })).attachment;
    const lane = request(root, env, requestPayload({ attachment_id: laneAttachment.id, base, head, covers: ['#g1'] }), '#l1');
    expect(lane.status).toBe('awaiting_review');
    expect(run(root, env, 'review', 'show', child.id, '--json').status).toBe('superseded');
  });

  it('reuses only exact request intent, rejects partial Goal overlap, and coalesces fully covered Lane requests atomically', () => {
    const { root, env, base, head } = workspace();
    run(root, env, 'lane', 'create', JSON.stringify({ title: 'Lane', product_goals: ['Selected goals'] }));
    const attachment1 = makeGoal(root, env, { lane_id: 'l1', title: 'Goal one' });
    run(root, env, 'goal', 'create', JSON.stringify({ title: 'Goal two', description: 'Second selected goal', lane_id: 'l1' }));
    run(root, env, 'attachment', 'add', '#g2', JSON.stringify({
      type: 'markdown', path: 'docs/CR-001.md', purpose: 'cr',
    })).attachment.id;
    const first = request(root, env, requestPayload({ attachment_id: attachment1, base, head }));
    const exactRetry = request(root, env, requestPayload({ attachment_id: attachment1, base, head }));
    expect(exactRetry.id).toBe(first.id);
    let prior = first;
    for (const intent of [
      { reviewer: 'other-reviewer' },
      { summary: 'A revised summary.' },
      { validation: { command: 'npm test', status: 'rerun' } },
      { delivery: { endpoint_type: 'release' } },
    ]) {
      const changed = request(root, env, { ...requestPayload({ attachment_id: attachment1, base, head }), ...intent });
      expect(changed.id).not.toBe(prior.id);
      expect(run(root, env, 'review', 'show', prior.id, '--json').status).toBe('superseded');
      prior = changed;
    }

    const laneAttachment = run(root, env, 'attachment', 'add', '#l1', JSON.stringify({
      type: 'markdown', path: 'docs/CR-001.md', purpose: 'cr',
    })).attachment.id;
    const coversBoth = request(root, env, requestPayload({ attachment_id: laneAttachment, base, head,
      covers: ['#g1', '#g2'] }), '#l1');
    expect(coversBoth.status).toBe('awaiting_review');
    const partial = fails(root, env, 'review', 'request', '#l1', '--file', payloadFile(root,
      requestPayload({ attachment_id: laneAttachment, base, head, covers: ['#g1'] })));
    expect(partial).toContain('also covers #g002');
    expect(run(root, env, 'review', 'show', coversBoth.id, '--json').status).toBe('awaiting_review');

    const fullReplacement = request(root, env, requestPayload({ attachment_id: laneAttachment, base, head,
      covers: ['#g1', '#g2'], reviewer: 'replacement-reviewer' }), '#l1');
    expect(fullReplacement.id).not.toBe(coversBoth.id);
    expect(run(root, env, 'review', 'show', coversBoth.id, '--json').status).toBe('superseded');
  }, 30_000);

  it('keeps a deferred request pinned and permits a later explicit reviewer approval', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    const deferred = run(root, env, 'review', 'decide', review.id, '--file', payloadFile(root,
      decidePayload(review, { decision: 'deferred', comment: 'Waiting for the reviewer.' })));
    expect(deferred.status).toBe('deferred');
    expect(request(root, env, requestPayload({ attachment_id, base, head })).id).toBe(review.id);
    const approved = run(root, env, 'review', 'decide', review.id, '--file', payloadFile(root,
      decidePayload(deferred, { decision: 'approved', comment: 'Explicitly resumed and approved.' })));
    expect(approved).toMatchObject({ status: 'approved', decision: 'approved', revision: 3 });
  });

  it('imports only a read-only GitHub review event for the exact reviewer and candidate, idempotently', () => {
    const { root, env, base, head } = workspace({ lane_pr_mode: 'ready' });
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: true, lane_pr_mode: 'ready' }));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const eventFile = path.join(root, 'github-review.json');
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nif [ "$1" = "pr" ]; then printf 'https://github.com/acme/app/pull/11\\n'; else cat '${eventFile}'; fi\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    env.PATH = `${bin}:${env.PATH}`;
    const linked = run(root, env, 'review', 'pr', 'materialize', review.id, '--confirm');
    const githubEvent = ({ login = 'reviewer', commit = head, state = 'APPROVED', body = 'Approved.' } = {}) => ({ data: { node: {
      id: 'PRR_kwDOReview001', author: { login }, state,
      commit: { oid: commit }, submittedAt: '2026-10-22T10:00:00Z', body, pullRequest: {
        url: linked.link, baseRefOid: base, headRefOid: head,
      },
    } } });
    fs.writeFileSync(eventFile, JSON.stringify(githubEvent({ login: 'impostor' })));
    expect(fails(root, env, 'review', 'pr', 'import', review.id, '--event', 'PRR_kwDOReview001', '--json'))
      .toContain('must match assigned reviewer');
    fs.writeFileSync(eventFile, JSON.stringify(githubEvent({ commit: base })));
    expect(fails(root, env, 'review', 'pr', 'import', review.id, '--event', 'PRR_kwDOReview001', '--json'))
      .toContain('event commit does not match');
    fs.writeFileSync(eventFile, JSON.stringify(githubEvent()));
    const imported = run(root, env, 'review', 'pr', 'import', review.id, '--event', 'PRR_kwDOReview001', '--json');
    expect(imported).toMatchObject({ status: 'approved', decision: 'approved', external_decision: {
      provider: 'github', event_id: 'PRR_kwDOReview001', login: 'reviewer', commit: head, pull_request_url: linked.link,
    } });
    const retry = run(root, env, 'review', 'pr', 'import', review.id, '--event', 'PRR_kwDOReview001', '--json');
    expect(retry.revision).toBe(imported.revision);
    expect(fs.readFileSync(path.join(root, '.clips', 'db', 'reviews.jsonl'), 'utf8').match(/review_external_decision_imported/g)).toHaveLength(1);
    fs.writeFileSync(eventFile, JSON.stringify(githubEvent({ state: 'CHANGES_REQUESTED', body: 'Changed event.' })));
    expect(fails(root, env, 'review', 'pr', 'import', review.id, '--event', 'PRR_kwDOReview001', '--json')).toContain('changed since it was imported');
  });

  it('rejects external review import when the pinned local source candidate is stale', () => {
    const { root, env, base, head } = workspace({ lane_pr_mode: 'ready' });
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: true, lane_pr_mode: 'ready' }));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const marker = path.join(root, 'gh-called');
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${marker}'\nif [ "$1" = "pr" ]; then printf 'https://github.com/acme/app/pull/12\\n'; fi\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    env.PATH = `${bin}:${env.PATH}`;
    run(root, env, 'review', 'pr', 'materialize', review.id, '--confirm');
    fs.writeFileSync(path.join(root, 'source.txt'), 'moved after PR review\n');
    git(root, 'commit', '--quiet', '-am', 'move candidate');
    expect(fails(root, env, 'review', 'pr', 'import', review.id, '--event', 'PRR_kwDOReview002', '--json')).toContain('is stale');
    expect(fs.readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['pr']);
  });

  it('does not partially supersede if the review journal lock is held', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const first = request(root, env, requestPayload({ attachment_id, base, head }));
    const file = path.join(root, '.clips', 'db', 'reviews.jsonl');
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(`${file}.lock`, 'held by test\n');
    expect(fails(root, env, 'review', 'request', '#g1', '--file', payloadFile(root,
      requestPayload({ attachment_id, base, head, reviewer: 'replacement' })))).toContain('Record is being written');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    fs.rmSync(`${file}.lock`);
    const second = request(root, env, requestPayload({ attachment_id, base, head, reviewer: 'replacement' }));
    expect(second.id).not.toBe(first.id);
    expect(run(root, env, 'review', 'show', first.id, '--json').status).toBe('superseded');
  });

  it('rejects wrong actor/candidate, stales changed CR and contracts, and keeps pinned text visible', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    fails(root, env, 'review', 'decide', review.id, '--file', payloadFile(root, decidePayload(review, { actor: 'impostor' })));
    fails(root, env, 'review', 'decide', review.id, '--file', payloadFile(root, decidePayload(review, { candidate: { base: head, head } })));
    fs.writeFileSync(path.join(root, 'docs', 'CR-001.md'), '# Changed CR\n');
    const stale = run(root, env, 'review', 'show', review.id, '--json');
    expect(stale).toMatchObject({ stale: true, status: 'awaiting_review', attachment: {
      content: '# Change request\n\nPinned request body.\n', current_content: '# Changed CR\n',
    } });
    expect(stale.stale_reasons).toContain('attachment_content_changed');
    fails(root, env, 'review', 'decide', review.id, '--file', payloadFile(root, decidePayload(review)));
  });

  it('uses exact local branches for review while retaining tracking-ref checks at PR materialization', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const headRef = 'feat/lane-review-delivery';
    const payload = requestPayload({ attachment_id, base, head });
    payload.candidate.base_ref = 'main';
    payload.candidate.head_ref = headRef;

    // Model unpushed local work and stale/ambiguous tracking refs without contacting a remote.
    git(root, 'update-ref', 'refs/remotes/origin/main', base);
    git(root, 'update-ref', `refs/remotes/origin/${headRef}`, base);
    git(root, 'update-ref', 'refs/remotes/upstream/main', head);

    const review = request(root, env, payload);
    expect(review).toMatchObject({ stale: false, candidate: { base_ref: 'main', head_ref: headRef } });
    expect(run(root, env, 'review', 'show', review.id, '--json')).toMatchObject({ stale: false, status: 'awaiting_review' });
    const approved = run(root, env, 'review', 'decide', review.id, '--file', payloadFile(root, decidePayload(review)));
    expect(approved).toMatchObject({ stale: false, status: 'approved' });

    fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: true, lane_pr_mode: 'ready' }));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const marker = path.join(root, 'gh-called');
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf 'called\\n' > '${marker}'\nprintf 'https://github.com/acme/app/pull/20\\n'\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    env.PATH = `${bin}:${env.PATH}`;
    expect(fails(root, env, 'review', 'pr', 'materialize', review.id, '--confirm')).toContain('no longer points to its pinned commit');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('stales approval when a source commit moves candidate head, not when only workflow labels change', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    run(root, env, 'label', 'create', JSON.stringify({ id: 'reviewed', name: 'Reviewed', color: '#778899' }));
    expect(run(root, env, 'review', 'show', review.id, '--json').stale).toBe(false);
    fs.writeFileSync(path.join(root, 'source.txt'), 'new source commit\n');
    git(root, 'commit', '--quiet', '-am', 'source moved');
    const stale = run(root, env, 'review', 'show', review.id, '--json');
    expect(stale.stale).toBe(true);
    expect(stale.stale_reasons).toContain('candidate_head_moved');
  });

  it('materializes only explicit configured draft/ready PRs and keeps review status separate from completion', () => {
    const { root, env, base, head } = workspace({ lane_pr_mode: 'draft' });
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const marker = path.join(root, 'gh-args.json');
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nprintf 'https://github.com/acme/app/pull/10\\n'\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    env.PATH = `${bin}:${env.PATH}`;

    fails(root, env, 'review', 'pr', 'materialize', review.id, '--confirm');
    expect(fs.existsSync(marker)).toBe(false);
    fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: true, lane_pr_mode: 'prepare' }));
    fails(root, env, 'review', 'pr', 'materialize', review.id, '--confirm');
    expect(fs.existsSync(marker)).toBe(false);
    fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: true, lane_pr_mode: 'draft' }));
    const materialized = run(root, env, 'review', 'pr', 'materialize', review.id, '--confirm');
    expect(materialized).toMatchObject({ link: 'https://github.com/acme/app/pull/10', status: 'awaiting_review',
      pull_request: { mode: 'draft', candidate: { base, head } } });
    const args = fs.readFileSync(marker, 'utf8');
    expect(args).toContain('--draft');
    expect(args).toContain('main');
    expect(args).toContain('feat/lane-review-delivery');

    const afterPr = run(root, env, 'review', 'show', review.id, '--json');
    expect(afterPr.status).toBe('awaiting_review');
    const approved = run(root, env, 'review', 'decide', review.id, '--file', payloadFile(root, decidePayload(afterPr)));
    expect(approved.status).toBe('approved');
    fails(root, env, 'review', 'complete', review.id, '--file', payloadFile(root, {
      actor: 'delivery-agent', candidate: approved.candidate, endpoint: { type: 'other', url: 'file:///tmp/x' },
    }));
    const complete = run(root, env, 'review', 'complete', review.id, '--file', payloadFile(root, {
      actor: 'delivery-agent', candidate: approved.candidate,
      endpoint: { type: 'github_pr', url: 'https://github.com/acme/app/pull/10' }, expected_revision: approved.revision,
    }));
    expect(complete).toMatchObject({ status: 'delivered', delivered_by: 'delivery-agent', delivery: {
      type: 'github_pr', url: 'https://github.com/acme/app/pull/10',
    } });
    expect(complete.delivery).not.toHaveProperty('commit');
    expect(run(root, env, 'goal', 'show', 'g1').status).toBe('open');
  });

  it('completes after a real local merge only when the target tip contains the approved head and exact tree', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    const approved = run(root, env, 'review', 'decide', review.id, '--file', payloadFile(root, decidePayload(review)));
    git(root, 'switch', '--quiet', 'main');
    git(root, 'merge', '--quiet', '--no-ff', '-m', 'integrate approved candidate', 'feat/lane-review-delivery');
    const deliveredCommit = git(root, 'rev-parse', 'HEAD');
    expect(deliveredCommit).not.toBe(head);
    fails(root, env, 'review', 'complete', review.id, '--file', payloadFile(root, {
      actor: 'release-manager', candidate: approved.candidate,
      endpoint: { type: 'git', ref: 'main', commit: head }, expected_revision: approved.revision,
    }));
    const complete = run(root, env, 'review', 'complete', review.id, '--file', payloadFile(root, {
      actor: 'release-manager', candidate: approved.candidate,
      endpoint: { type: 'git', ref: 'main', commit: deliveredCommit }, expected_revision: approved.revision,
    }));
    expect(complete).toMatchObject({ status: 'delivered', delivered_by: 'release-manager', delivery: {
      type: 'git', ref: 'main', commit: deliveredCommit, approved_head: head,
    } });
    expect(run(root, env, 'review', 'show', review.id, '--json')).toMatchObject({ status: 'delivered', stale: false, stale_reasons: [] });
    fs.writeFileSync(path.join(root, 'source.txt'), 'unrelated work after delivery\n');
    git(root, 'commit', '--quiet', '-am', 'later unrelated work');
    expect(run(root, env, 'review', 'show', review.id, '--json')).toMatchObject({ status: 'delivered', stale: false, stale_reasons: [] });
    expect(run(root, env, 'goal', 'show', 'g1').status).toBe('open');
  });

  it('does not let a URL endpoint excuse a moved source candidate', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    const approved = run(root, env, 'review', 'decide', review.id, '--file', payloadFile(root, decidePayload(review)));
    fs.writeFileSync(path.join(root, 'source.txt'), 'source moved after approval\n');
    git(root, 'commit', '--quiet', '-am', 'move approved source');
    expect(fails(root, env, 'review', 'complete', review.id, '--file', payloadFile(root, {
      actor: 'release-manager', candidate: approved.candidate,
      endpoint: { type: 'url', url: 'https://example.test/delivery-record' }, expected_revision: approved.revision,
    }))).toContain('is stale');
  });
});

describe('pinned review Markdown export', () => {
  it('exports the immutable pinned CR with candidate and stale context without changing the request journal', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    const journalPath = path.join(root, '.clips', 'db', 'reviews.jsonl');
    const before = fs.readFileSync(journalPath, 'utf8');

    fs.writeFileSync(path.join(root, 'docs', 'CR-001.md'), '# Changed request\n\nCurrent live text.\n');
    const opened = run(root, env, 'review', 'open', '#g1', '--json');
    const normalOutput = invoke(root, env, 'review', 'open', '#g1');
    expect(normalOutput.status).toBe(0);
    expect(normalOutput.stdout.trim()).toBe(opened.path);
    expect(opened).toMatchObject({
      review: { id: review.id, ref: '#g001', status: 'awaiting_review', reviewer: 'reviewer',
        candidate: { base, head }, stale: true, stale_reasons: ['attachment_content_changed'] },
      requested_ref: '#g001', content_identity: { sha256: expect.any(String) },
    });
    expect(path.isAbsolute(opened.path)).toBe(true);
    expect(opened.path).toMatch(/\.md$/);
    expect(fs.readFileSync(opened.path, 'utf8')).toContain('# CR-001: Change request\n\n- Review ID: ' + review.id);
    expect(fs.readFileSync(opened.path, 'utf8')).toContain(`- Candidate base: ${base} (main)`);
    expect(fs.readFileSync(opened.path, 'utf8')).toContain('- Stale: Yes (attachment_content_changed)');
    expect(fs.readFileSync(opened.path, 'utf8')).toContain('## Pinned change request\n\n# Change request\n\nPinned request body.\n');
    expect(fs.readFileSync(journalPath, 'utf8')).toBe(before);
    expect(fs.readFileSync(path.join(root, 'docs', 'CR-001.md'), 'utf8')).toContain('Current live text.');
    expect(invoke(root, env, 'review', 'open', review.id).stdout.trim()).toBe(opened.path);

    fs.writeFileSync(opened.path, 'agent edits do not mutate the review');
    const reopened = run(root, env, 'review', 'open', review.id, '--json');
    expect(reopened.path).toBe(opened.path);
    expect(fs.readFileSync(reopened.path, 'utf8')).toContain('Pinned request body.');
    expect(fs.readFileSync(journalPath, 'utf8')).toBe(before);
  });

  it('matches coalesced coverage from the pinned obligations and excludes Tasks added afterward', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    const task = run(root, env, 'task', 'create', '#g1', JSON.stringify({
      title: 'Added after review', description: 'This task was not in the pinned coverage.',
    }));
    const openedGoalReview = run(root, env, 'review', 'open', '#g1#t1', '--json');
    expect(openedGoalReview.review.id).toBe(review.id);
    expect(fails(root, env, 'review', 'open', '#g1#t2')).toContain('No actionable CR review found');
    expect(openedGoalReview.review.stale).toBe(true);
    expect(openedGoalReview.review.stale_reasons).toContain('coverage_changed');
  });

  it('reports missing and ambiguous record requests without choosing a review', () => {
    const { root, env, base, head } = workspace();
    const attachment_id = makeGoal(root, env);
    const review = request(root, env, requestPayload({ attachment_id, base, head }));
    expect(fails(root, env, 'review', 'open', '#g99')).toContain('Goal g99 not found');

    const reviewFile = path.join(root, '.clips', 'db', 'reviews.jsonl');
    const events = fs.readFileSync(reviewFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const requestEvent = events.find((event) => event.event === 'review_requested');
    const duplicate = structuredClone(requestEvent);
    duplicate.review.id = 'rev-00000000-0000-4000-8000-000000000001';
    duplicate.review.created_at = new Date().toISOString();
    duplicate.timestamp = duplicate.review.created_at;
    fs.appendFileSync(reviewFile, `${JSON.stringify(duplicate)}\n`);
    const error = fails(root, env, 'review', 'open', '#g1');
    expect(error).toContain('Multiple actionable CR reviews cover #g001');
    expect(error).toContain(review.id);
    expect(error).toContain(duplicate.review.id);
  });
});
