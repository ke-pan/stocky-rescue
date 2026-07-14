import { writeFile as writeFileOnDisk } from 'node:fs/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { createStockyArchive } from './index.js';
import { EXPORTER_VERSION } from './version.js';

interface ParsedArguments {
  help: boolean;
  version: boolean;
  shop?: string;
  output?: string;
}

export interface CliDependencies {
  fetch?: typeof fetch;
  now?: () => Date;
  readLine?: (prompt: string) => Promise<string>;
  readSecret?: (prompt: string) => Promise<string>;
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

const usage = `Stocky Rescue ${EXPORTER_VERSION}

Create a local, portable archive from the official Stocky API.

Usage:
  stocky-rescue [--shop STORE.myshopify.com] [--output FILE.zip]

Options:
  --shop       Shopify store domain (prompted when omitted)
  --output     Archive path (defaults to a timestamped file)
  --help       Show this help
  --version    Show the exporter version

The Stocky API key is accepted only at a hidden local prompt. It cannot be passed as an
argument or environment option and is never written to the archive.
`;

function parseArguments(argv: string[]): ParsedArguments {
  const parsed: ParsedArguments = { help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument === '--version' || argument === '-v') parsed.version = true;
    else if (argument === '--api-key' || argument.startsWith('--api-key=')) {
      throw new Error('API keys are accepted only at the hidden prompt');
    } else if (argument === '--shop' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value`);
      if (argument === '--shop') parsed.shop = value;
      else parsed.output = value;
      index += 1;
    } else if (argument.startsWith('--shop=')) parsed.shop = argument.slice('--shop='.length);
    else if (argument.startsWith('--output=')) parsed.output = argument.slice('--output='.length);
    else if (argument.startsWith('-')) throw new Error('Unknown option. Run with --help.');
    else throw new Error('Unexpected positional argument. Run with --help.');
  }
  return parsed;
}

function normalizeShopDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error('Enter a valid .myshopify.com domain, such as example.myshopify.com');
  }
  return domain;
}

async function readLineFromTerminal(prompt: string): Promise<string> {
  const terminal = createInterface({ input: processStdin, output: processStdout });
  try {
    return await terminal.question(prompt);
  } finally {
    terminal.close();
  }
}

async function readSecretFromTerminal(prompt: string): Promise<string> {
  if (!processStdin.isTTY || !processStdout.isTTY || !processStdin.setRawMode) {
    throw new Error('The API key requires an interactive terminal with hidden input');
  }

  processStdout.write(prompt);
  processStdin.setRawMode(true);
  processStdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let secret = '';
    const cleanup = () => {
      processStdin.off('data', onData);
      processStdin.setRawMode(false);
      processStdin.pause();
      processStdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Export cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(secret);
          return;
        }
        if (character === '\u007f' || character === '\b') secret = secret.slice(0, -1);
        else if (character >= ' ') secret += character;
      }
    };
    processStdin.on('data', onData);
  });
}

function defaultFilename(shopDomain: string, now: Date): string {
  const shop = shopDomain.slice(0, -'.myshopify.com'.length);
  const timestamp = now.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.000', '');
  return `stocky-rescue-${shop}-${timestamp}.zip`;
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const writeStdout = dependencies.stdout ?? ((message) => process.stdout.write(`${message}\n`));
  const writeStderr = dependencies.stderr ?? ((message) => process.stderr.write(`${message}\n`));
  let apiKey = '';

  try {
    const args = parseArguments(argv);
    if (args.help) {
      writeStdout(usage);
      return 0;
    }
    if (args.version) {
      writeStdout(EXPORTER_VERSION);
      return 0;
    }

    const readLine = dependencies.readLine ?? readLineFromTerminal;
    const readSecret = dependencies.readSecret ?? readSecretFromTerminal;
    const now = (dependencies.now ?? (() => new Date()))();
    const shopDomain = normalizeShopDomain(
      args.shop ?? (await readLine('Shop domain (example.myshopify.com): ')),
    );
    apiKey = await readSecret('Stocky API key: ');
    if (!apiKey.trim()) throw new Error('The Stocky API key cannot be empty');

    const result = await createStockyArchive({
      shopDomain,
      apiKey,
      fetch: dependencies.fetch,
      now: () => now,
    });
    const output = args.output ?? defaultFilename(shopDomain, now);
    const writeFile =
      dependencies.writeFile ??
      (async (path: string, data: Uint8Array) => {
        await writeFileOnDisk(path, data, { flag: 'wx' });
      });
    await writeFile(output, result.archive);

    writeStdout(`Archive written to ${output}`);
    if (result.manifest.status === 'incomplete') {
      writeStderr('INCOMPLETE: one or more Stocky endpoints failed. Review manifest.json.');
      return 2;
    }
    writeStdout('Status: complete');
    return 0;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Unknown export error';
    writeStderr(`Error: ${apiKey ? rawMessage.replaceAll(apiKey, '[REDACTED]') : rawMessage}`);
    return 1;
  } finally {
    apiKey = '';
  }
}
