import fs from 'node:fs';

/** Read one JSON payload from an argument, an exact file, or standard input. */
export function readJsonInput(args) {
  let source;
  if (args.length === 1 && args[0] === '--stdin') source = fs.readFileSync(0, 'utf8');
  else if (args.length === 2 && args[0] === '--file') source = fs.readFileSync(args[1], 'utf8');
  else if (args.length === 1 && !args[0].startsWith('--')) source = args[0];
  else throw new Error('Provide one JSON argument, --file <path>, or --stdin');
  try { return JSON.parse(source); }
  catch (error) { throw new Error(`Invalid JSON input: ${error.message}`); }
}
