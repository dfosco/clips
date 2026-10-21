import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject } from './work-fields.js';

const ATTACHMENT_TYPES = new Set(['markdown', 'url', 'github_issue', 'github_pr']);
const UUID_ATTACHMENT_ID = /^att-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function safeHttpUrl(value, label = 'url') {
  const text = requiredText(value, label);
  let url;
  try { url = new URL(text); }
  catch { throw new Error(`${label} must be an absolute HTTP or HTTPS URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL without credentials`);
  }
  return url;
}

function githubIdentity(value, type) {
  const url = safeHttpUrl(value, 'GitHub attachment url');
  if (url.protocol !== 'https:') throw new Error('GitHub attachment urls must use HTTPS');
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/([1-9]\d*)\/?$/);
  const expectedPath = type === 'github_issue' ? 'issues' : 'pull';
  if (!match || match[3] !== expectedPath) {
    throw new Error(`${type} url must identify a GitHub ${expectedPath} at /<owner>/<repo>/${expectedPath}/<number>`);
  }
  const number = Number(match[4]);
  if (!Number.isSafeInteger(number)) throw new Error('GitHub attachment number must be a safe positive integer');
  return {
    url: url.toString(),
    host: url.host.toLowerCase(),
    repository: `${match[1]}/${match[2]}`,
    number,
  };
}

function assertExpectedRevision(value) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error('expected_revision must be a non-negative integer');
  }
  return value;
}

function normalizeFileReference(value, repoRoot) {
  const source = requiredText(value, 'path');
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(path.isAbsolute(source) ? source : path.join(root, source));
  const relative = path.relative(root, resolved);
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (outside) return resolved;
  if (!relative) throw new Error('path must identify a Markdown file, not the repository root');
  return relative.split(path.sep).join('/');
}

function validateStoredAttachment(attachment) {
  if (!isPlainObject(attachment)) throw new Error('Corrupt attachment state: attachment must be an object');
  const { id, type, title } = attachment;
  if (typeof id !== 'string' || !UUID_ATTACHMENT_ID.test(id)) throw new Error('Corrupt attachment state: invalid attachment ID');
  if (!ATTACHMENT_TYPES.has(type)) throw new Error(`Corrupt attachment state: unsupported attachment type '${type}'`);
  const normalizedTitle = requiredText(title, 'attachment title');
  const common = { id, type, title: normalizedTitle };

  if (type === 'markdown') {
    if (Object.keys(attachment).some((key) => !['id', 'type', 'title', 'path'].includes(key))) {
      throw new Error('Corrupt Markdown attachment state: unsupported fields');
    }
    const fileRef = requiredText(attachment.path, 'attachment path');
    if (!path.isAbsolute(fileRef) && (path.posix.normalize(fileRef) === '..' || path.posix.normalize(fileRef).startsWith('../'))) {
      throw new Error('Corrupt Markdown attachment state: external paths must be absolute');
    }
    return { ...common, path: fileRef };
  }

  if (type === 'url') {
    if (Object.keys(attachment).some((key) => !['id', 'type', 'title', 'url'].includes(key))) {
      throw new Error('Corrupt URL attachment state: unsupported fields');
    }
    return { ...common, url: safeHttpUrl(attachment.url).toString() };
  }

  if (Object.keys(attachment).some((key) => !['id', 'type', 'title', 'url', 'host', 'repository', 'number'].includes(key))) {
    throw new Error(`Corrupt ${type} attachment state: unsupported fields`);
  }
  const identity = githubIdentity(attachment.url, type);
  if (typeof attachment.host !== 'string' || attachment.host.toLowerCase() !== identity.host
    || typeof attachment.repository !== 'string' || attachment.repository.toLowerCase() !== identity.repository.toLowerCase()
    || attachment.number !== identity.number) {
    throw new Error(`Corrupt ${type} attachment state: remote identity does not match its URL`);
  }
  return { ...common, ...identity };
}

export function normalizeAttachmentInput(input, { repoRoot }) {
  if (!isPlainObject(input)) throw new Error('Attachment input must be a JSON object');
  const expectedRevision = assertExpectedRevision(input.expected_revision);
  const type = input.type;
  if (!ATTACHMENT_TYPES.has(type)) {
    throw new Error(`type must be one of: ${[...ATTACHMENT_TYPES].join(', ')}`);
  }
  const allowed = new Set(type === 'markdown' ? ['type', 'title', 'path', 'expected_revision']
    : type === 'url' ? ['type', 'title', 'url', 'expected_revision']
      : ['type', 'title', 'url', 'host', 'repository', 'number', 'expected_revision']);
  const unsupported = Object.keys(input).filter((key) => !allowed.has(key));
  if (unsupported.length) throw new Error(`Unsupported attachment fields: ${unsupported.join(', ')}`);
  const title = input.title === undefined ? null : requiredText(input.title, 'title');

  let attachment;
  if (type === 'markdown') {
    const pathRef = normalizeFileReference(input.path, repoRoot);
    attachment = { type, title: title || path.basename(pathRef), path: pathRef };
  } else if (type === 'url') {
    const url = safeHttpUrl(input.url).toString();
    attachment = { type, title: title || url, url };
  } else {
    const identity = githubIdentity(input.url, type);
    if (input.host !== undefined && (typeof input.host !== 'string' || input.host.toLowerCase() !== identity.host)) {
      throw new Error('host must match the GitHub attachment url host');
    }
    if (input.repository !== undefined && (typeof input.repository !== 'string'
      || input.repository.toLowerCase() !== identity.repository.toLowerCase())) {
      throw new Error('repository must match the GitHub attachment url repository');
    }
    if (input.number !== undefined && input.number !== identity.number) {
      throw new Error('number must match the GitHub attachment url number');
    }
    attachment = {
      type,
      title: title || `${identity.repository}#${identity.number}`,
      ...identity,
    };
  }
  return { attachment, expectedRevision };
}

export function newAttachmentId() {
  return `att-${randomUUID()}`;
}

export function replayAttachmentEvent(attachments, event) {
  const current = Array.isArray(attachments) ? attachments.map(validateStoredAttachment) : [];
  const allowed = new Set(['event', 'goal_id', 'task_id', 'lane_id', 'track_id', 'timestamp',
    ...(event.event === 'attachment_added' ? ['attachment'] : ['attachment_id'])]);
  const unsupported = Object.keys(event).filter((key) => !allowed.has(key));
  if (unsupported.length) throw new Error(`Corrupt attachment history: unsupported fields ${unsupported.join(', ')}`);
  if (Object.hasOwn(event, 'task_id') && (typeof event.task_id !== 'string' || !/^t\d+$/i.test(event.task_id))) {
    throw new Error('Corrupt attachment history: invalid task reference');
  }
  if (event.event === 'attachment_added') {
    if (!Object.hasOwn(event, 'attachment')) throw new Error('Corrupt attachment history: missing attachment metadata');
    const attachment = validateStoredAttachment(event.attachment);
    if (current.some((item) => item.id === attachment.id)) {
      throw new Error(`Corrupt attachment history: duplicate attachment ID ${attachment.id}`);
    }
    return [...current, attachment];
  }
  if (event.event === 'attachment_removed') {
    if (!Object.hasOwn(event, 'attachment_id')) throw new Error('Corrupt attachment history: missing attachment ID');
    if (typeof event.attachment_id !== 'string' || !UUID_ATTACHMENT_ID.test(event.attachment_id)) {
      throw new Error('Corrupt attachment history: invalid removed attachment ID');
    }
    if (!current.some((item) => item.id === event.attachment_id)) {
      throw new Error(`Corrupt attachment history: attachment ${event.attachment_id} was not attached`);
    }
    return current.filter((item) => item.id !== event.attachment_id);
  }
  throw new Error(`Unsupported attachment event: ${event.event}`);
}

function legacyGithubAttachment({ type, number, url, repository, key }) {
  const suppliedNumber = number == null ? null : Number(number);
  const validSuppliedNumber = Number.isSafeInteger(suppliedNumber) && suppliedNumber > 0;
  let identity = { url: null, host: null, repository: repository || null, number: validSuppliedNumber ? suppliedNumber : null };
  let identityError;
  if (number != null && !validSuppliedNumber) identityError = 'legacy remote number is invalid';
  if (url) {
    try {
      const parsed = githubIdentity(url, type);
      if ((validSuppliedNumber && parsed.number !== suppliedNumber)
        || (repository && parsed.repository.toLowerCase() !== repository.toLowerCase())) {
        throw new Error('legacy remote identity does not match its URL');
      }
      identity = identityError ? { ...parsed, url: null } : parsed;
    } catch (error) {
      identityError = error.message;
    }
  }
  if (identity.number == null && !identityError) identityError = 'legacy remote number is missing';
  const digest = createHash('sha256').update(`${type}\0${key || ''}\0${identity.host || ''}\0${identity.repository || ''}\0${identity.number || ''}\0${url || ''}`).digest('hex').slice(0, 16);
  return {
    id: `legacy-${type}-${digest}`,
    type,
    title: `${identity.repository || 'GitHub'}${identity.number ? `#${identity.number}` : ''}`,
    ...identity,
    source: 'legacy',
    ...(identityError ? { identity_error: identityError } : {}),
  };
}

export function legacyAttachments(record) {
  const attachments = [];
  if (record.github_prs !== undefined && !isPlainObject(record.github_prs)) {
    throw new Error('Corrupt legacy GitHub PR attachments: expected an object');
  }
  if (record.issue_number !== undefined && record.issue_number !== null) {
    attachments.push(legacyGithubAttachment({
      type: 'github_issue',
      number: record.issue_number,
      url: record.issue_url,
      repository: record.repository,
      key: 'issue',
    }));
  }
  for (const [key, pr] of Object.entries(record.github_prs || {})) {
    if (!isPlainObject(pr)) throw new Error(`Corrupt legacy GitHub PR attachment '${key}'`);
    attachments.push(legacyGithubAttachment({
      type: 'github_pr',
      number: pr.pr_number,
      url: pr.url || pr.html_url,
      repository: pr.repository,
      key,
    }));
  }
  return attachments;
}

export function attachmentsForRecord(record) {
  if (!isPlainObject(record)) throw new Error('Corrupt attachment state: record must be an object');
  if (record.attachments !== undefined && !Array.isArray(record.attachments)) {
    throw new Error('Corrupt attachment state: attachments must be an array');
  }
  const explicit = (record.attachments || []).map(validateStoredAttachment);
  if (new Set(explicit.map((item) => item.id)).size !== explicit.length) {
    throw new Error('Corrupt attachment state: duplicate attachment IDs');
  }
  return [...explicit, ...legacyAttachments(record)];
}

function resolveFilePath(attachment, repoRoot) {
  const root = path.resolve(repoRoot);
  if (path.isAbsolute(attachment.path)) return path.resolve(attachment.path);
  const filePath = path.resolve(root, attachment.path);
  const relative = path.relative(root, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Corrupt Markdown attachment state: relative path escapes the repository');
  }
  return filePath;
}

function readMarkdownAttachment(attachment, repoRoot) {
  const filePath = resolveFilePath(attachment, repoRoot);
  try {
    return { status: 'available', content: fs.readFileSync(filePath, 'utf8'), content_semantics: 'current_file' };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return { status: 'missing', content: null, error: 'The attached Markdown file is missing.', content_semantics: 'current_file' };
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return { status: 'unreadable', content: null, error: 'Permission denied while reading the attached Markdown file.', content_semantics: 'current_file' };
    }
    return {
      status: 'unreadable',
      content: null,
      error: `Unable to read the attached Markdown file (${error.code || 'I/O error'}).`,
      content_semantics: 'current_file',
    };
  }
}

function readAttachmentContent(attachment, { repoRoot }) {
  if (attachment.source === 'legacy') {
    return {
      status: attachment.identity_error ? 'invalid' : 'remote',
      content: null,
      ...(attachment.identity_error ? { error: `Invalid legacy GitHub attachment: ${attachment.identity_error}` } : {}),
      content_semantics: 'not_fetched',
    };
  }
  if (attachment.type === 'markdown') {
    return readMarkdownAttachment(validateStoredAttachment(attachment), repoRoot);
  }
  validateStoredAttachment(attachment);
  return { status: 'remote', content: null, content_semantics: 'not_fetched' };
}

function attachmentForDisplay(attachment, { repoRoot }) {
  const metadata = { ...attachment };
  delete metadata.path;
  return { ...metadata, ...readAttachmentContent(attachment, { repoRoot }) };
}

export function readRecordAttachment(record, id, { repoRoot }) {
  const attachment = (record?.attachments || []).find((item) => item.id === id);
  if (!attachment) throw new Error(`Attachment ${id} is not associated with this record`);
  return attachmentForDisplay(attachment, { repoRoot });
}

export function displayRecordAttachments(record, { repoRoot }) {
  return (record?.attachments || []).map((attachment) => attachmentForDisplay(attachment, { repoRoot }));
}
