import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { tryGetRepoRoot } from './core.js';
import { effectiveProjectId, readProjectRegistry } from './registry.js';
import { readWorkspaceBoard } from './board.js';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export function parseWebArgs(args = []) {
  const options = { host: '127.0.0.1', port: 4173 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host') options.host = args[++index];
    else if (arg.startsWith('--host=')) options.host = arg.slice('--host='.length);
    else if (arg === '--port') options.port = Number(args[++index]);
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length));
    else throw new Error(`Unknown web option: ${arg}`);
  }
  if (!options.host) throw new Error('--host requires a value.');
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('--port must be an integer between 0 and 65535.');
  return options;
}

export function resolveBoardContext(cwd = process.cwd()) {
  const registry = readProjectRegistry();
  const currentRoot = tryGetRepoRoot(cwd, { requireClips: true });
  let availableProjects = registry.projects;
  let currentProject = currentRoot ? availableProjects.find((project) => project.path === currentRoot) : null;
  if (currentRoot && !currentProject) {
    currentProject = { id: effectiveProjectId(currentRoot), label: path.basename(currentRoot), path: currentRoot };
    availableProjects = [...availableProjects, currentProject];
  }
  return {
    availableProjects,
    defaultProjects: currentProject ? [currentProject] : availableProjects,
    scope: currentProject ? 'local' : 'all',
    warnings: registry.warnings,
  };
}

export function boardResponse(url, cwd = process.cwd()) {
  const context = resolveBoardContext(cwd);
  const requestedIds = url.searchParams.getAll('project');
  const unknownIds = requestedIds.filter((id) => !context.availableProjects.some((project) => project.id === id));
  if (unknownIds.length) return { status: 400, body: { error: `Unknown project: ${unknownIds.join(', ')}` } };
  const projects = requestedIds.length
    ? context.availableProjects.filter((project) => requestedIds.includes(project.id))
    : context.defaultProjects;
  return {
    status: 200,
    body: readWorkspaceBoard({
      projects,
      availableProjects: context.availableProjects,
      scope: requestedIds.length ? 'selected' : context.scope,
      warnings: context.warnings,
    }),
  };
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}

function serveAsset(request, response, assetsDir, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  let filePath = path.resolve(assetsDir, relativePath);
  if (!filePath.startsWith(`${path.resolve(assetsDir)}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) filePath = path.join(assetsDir, 'index.html');
  if (!fs.existsSync(filePath)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', MIME_TYPES[path.extname(filePath)] || 'application/octet-stream');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', path.basename(filePath) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable');
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(filePath).pipe(response);
}

export function createWebServer({ assetsDir, cwd = process.cwd() }) {
  return http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/api/board') {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        sendJson(response, 405, { error: 'Read-only API supports GET only.' });
        return;
      }
      try {
        const result = boardResponse(url, cwd);
        sendJson(response, result.status, result.body);
      } catch (error) {
        sendJson(response, 500, { error: 'Could not read Clips planning data.', detail: error.message });
      }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      response.writeHead(405).end('Method not allowed');
      return;
    }
    serveAsset(request, response, assetsDir, url.pathname);
  });
}
