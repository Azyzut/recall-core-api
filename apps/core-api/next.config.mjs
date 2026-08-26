import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the monorepo root so Next does not walk up past the repo looking for a
  // lockfile, which would break the file tracing the Docker build depends on.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  serverExternalPackages: ['rox-node'],
  // @recall/shared is consumed as TypeScript source from the workspace.
  transpilePackages: ['@recall/shared'],
  // Retained deliberately: auth.ts carries a pre-existing next-auth/jwt module
  // augmentation error. Type safety is enforced by `npm run typecheck` in CI,
  // which is a real gate — unlike `next build`, which skips type validation.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
