// User service — credential-bearing operations.
//
// findUserByEmail, linkUserToCompany and the User type now live in
// @recall/shared/services/user, because the discovery worker needs them. Anything
// touching bcrypt stays here so the auth surface is not reachable from the worker
// or the AI service. Re-exported below so existing call sites are unaffected.

import { db } from '@recall/shared/db';
import { findUserByEmail, toUser, type User } from '@recall/shared/services/user';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export { findUserByEmail, linkUserToCompany } from '@recall/shared/services/user';
export type { User } from '@recall/shared/services/user';

const SALT_ROUNDS = 12;

export interface CreateUserInput {
  email: string;
  password: string;
  companyId?: string;
}

/**
 * Create a new user with hashed password
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  const { email, password, companyId } = input;

  // Check if user already exists
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error('User with this email already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Generate UUID for the user
  const userId = randomUUID();

  // Insert user (companyId is null if not provided - will be linked later)
  const result = await db
    .insertInto('users')
    .values({
      id: userId,
      email: email.toLowerCase(),
      passwordHash,
      companyId: companyId || null,
      isAnonymous: false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toUser(result);
}

/**
 * Find user by ID
 */
export async function findUserById(id: string): Promise<User | null> {
  const result = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!result) return null;
  return toUser(result);
}

/**
 * Verify password against stored hash
 */
export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const result = await db
    .selectFrom('users')
    .selectAll()
    .where('email', '=', email.toLowerCase())
    .executeTakeFirst();

  if (!result || !result.passwordHash) {
    return null;
  }

  const isValid = await bcrypt.compare(password, result.passwordHash);
  if (!isValid) {
    return null;
  }

  // Update last active timestamp
  await db
    .updateTable('users')
    .set({ lastActiveAt: new Date() })
    .where('id', '=', result.id)
    .execute();

  return { ...toUser(result), lastActiveAt: new Date() };
}

/**
 * Get user with their company details
 */
export async function getUserWithCompany(userId: string) {
  const result = await db
    .selectFrom('users')
    .innerJoin('companies', 'companies.id', 'users.companyId')
    .select([
      'users.id',
      'users.email',
      'users.isAnonymous',
      'users.companyId',
      'users.createdAt',
      'users.lastActiveAt',
      'companies.companyName',
      'companies.website',
      'companies.naicsCode',
    ])
    .where('users.id', '=', userId)
    .executeTakeFirst();

  return result;
}
