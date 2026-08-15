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

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    companyId?: string | null;
  }
}
