import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { verifyPassword } from '@/lib/services/user';
import { authConfig } from '@recall/shared/auth-config';

/**
 * Full NextAuth config with Credentials provider
 * This runs in Node.js runtime only (not Edge)
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await verifyPassword(
          credentials.email as string,
          credentials.password as string
        );

        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          companyId: user.companyId,
        };
      },
    }),
  ],
});

// The `next-auth` Session/User augmentation moved to
// @recall/shared/auth-config, alongside the config whose callbacks depend on
// it — Web UI's middleware consumes that config too, and without the
// augmentation in scope there it does not typecheck.

// Augments '@auth/core/jwt', not 'next-auth/jwt'.
//
// next-auth/jwt.d.ts is a pure re-export — `export * from "@auth/core/jwt"` —
// with no declarations of its own, and TypeScript cannot merge an augmentation
// into a file that only re-exports. Augmenting it fails with TS2664 "Invalid
// module name in augmentation" even though `import type { JWT } from
// 'next-auth/jwt'` resolves perfectly well. The interface itself is declared in
// @auth/core/jwt, so that is what has to be augmented.
declare module '@auth/core/jwt' {
  interface JWT {
    id?: string;
    companyId?: string | null;
  }
}
