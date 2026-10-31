import { hashPassword } from '../server/auth.mjs';
// Read via hidden stdin; do not pass a password as a shell argument or commit it.
process.stderr.write('Enter a new owner password (14–256 characters), then press Enter: ');
let input = '';
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  if (chunk.includes('\u0003')) process.exit(130);
  input += chunk;
  if (/[\r\n]/.test(input)) break;
}
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
const password = input.split(/[\r\n]/)[0];
process.stderr.write('\n');
try { console.log('OWNER_PASSWORD_HASH=' + await hashPassword(password)); }
catch (error) { console.error(error.message); process.exitCode=1; }
