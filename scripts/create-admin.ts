import 'dotenv/config';
import readline from 'readline';
import { Writable } from 'stream';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import {
  ALL_PERMISSIONS,
  ROLE_DEFAULTS,
  parsePermissions,
  serializePermissions,
  type Permission,
} from '../src/lib/permissions';

const prisma = new PrismaClient();

// Create a readline interface with a mutable stdout so we can silence password input.
const mutableStdout: Writable & { muted?: boolean } = new Writable({
  write(chunk, encoding, cb) {
    if (!(this as typeof mutableStdout).muted) {
      process.stdout.write(chunk, encoding);
    }
    cb();
  },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: mutableStdout,
  terminal: true,
});

function question(prompt: string, opts?: { silent?: boolean }): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    mutableStdout.muted = !!opts?.silent;
    rl.question('', (answer) => {
      if (opts?.silent) process.stdout.write('\n');
      mutableStdout.muted = false;
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n🥊 Create a new admin user\n');

  const email = await question('Email: ');
  if (!email.includes('@')) {
    throw new Error('Invalid email');
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    throw new Error(`An admin with email "${email}" already exists.`);
  }

  const name = await question('Display name: ');
  if (name.length < 2) throw new Error('Name too short');

  const password = await question('Password (min 8 chars): ', { silent: true });
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const confirm = await question('Confirm password: ', { silent: true });
  if (password !== confirm) throw new Error('Passwords do not match');

  const roleInput = (await question('Role [ADMIN/MODERATOR] (default: ADMIN): ')) || 'ADMIN';
  const role = roleInput.toUpperCase();

  const defaults = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.ADMIN;
  console.log(`\nAvailable permissions: ${ALL_PERMISSIONS.join(', ')}`);
  console.log(`Default for ${role}: ${defaults.join(', ')}`);
  const permsInput = await question('Permissions (comma separated, empty = defaults): ');
  const permissions: Permission[] = permsInput
    ? parsePermissions(permsInput)
    : defaults;

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.adminUser.create({
    data: {
      email,
      name,
      passwordHash,
      role,
      permissions: serializePermissions(permissions),
    },
  });

  console.log(`\n✅ Admin created: ${user.email} (id: ${user.id})`);
  console.log(`   Role: ${user.role}`);
  console.log(`   Permissions: ${permissions.join(', ') || '(none)'}`);
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
