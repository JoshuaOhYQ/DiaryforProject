/**
 * Asking for passwords in the terminal. Typing is hidden in a real terminal; piped input
 * (one answer per line) works too, which is how the scripts are tested.
 */
import readline from 'node:readline';

let rl: readline.Interface | null = null;
let lines: AsyncIterator<string> | null = null;
let muted = false;

function open() {
  if (rl) return;
  const terminal = !!process.stdin.isTTY;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal });
  // readline echoes typed characters through this method; swallow them while a password is typed.
  const echo = rl as unknown as { _writeToOutput: (s: string) => void };
  const write = echo._writeToOutput.bind(rl);
  echo._writeToOutput = (s: string) => {
    if (!muted || s.includes('\n') || s.includes('\r')) write(muted ? '\n' : s);
  };
  lines = rl[Symbol.asyncIterator]();
}

/** Ask a question and return the line typed (hidden when `hidden`). */
export async function ask(question: string, hidden = false): Promise<string> {
  open();
  process.stdout.write(question);
  muted = hidden && !!process.stdin.isTTY;
  const next = await lines!.next();
  muted = false;
  if (next.done) throw new Error('No answer given (input ended).');
  return next.value;
}

/** Ask for a new password twice; repeats until both match and it is long enough. */
export async function askNewPassword(what: string, minLength = 8): Promise<string> {
  for (;;) {
    const first = await ask(`New password for ${what}: `, true);
    if (first.length < minLength) {
      console.log(`  Use at least ${minLength} characters.`);
      continue;
    }
    if ((await ask('Type it again: ', true)) === first) return first;
    console.log('  The two passwords are different. Try again.');
  }
}

export function closePrompt() {
  rl?.close();
  rl = null;
  lines = null;
}
