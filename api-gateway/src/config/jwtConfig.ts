import dotenv from 'dotenv';
import path from 'path';

// Ensure environment variables are loaded from the project root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const KNOWN_INSECURE_PLACEHOLDERS = new Set([
  'secret',
  'jwt_secret',
  'super_secret_jwt_key',
  'super_secret_refresh_key',
  'super_secret_refresh_key_123',
  'password',
  'changeme',
  'change_me',
  '12345678901234567890123456789012',
  'your_secret_key_here',
  'your_jwt_secret',
  'default_jwt_secret',
  'admin12345678901234567890123456'
]);

/**
 * Validates that JWT_SECRET is configured, non-empty, and satisfies baseline structural hygiene.
 *
 * POLICY SPECIFICATION:
 * 1. Missing / Empty Check: JWT_SECRET must be defined, non-empty, and non-whitespace.
 * 2. Minimum Length Threshold: Must be at least 32 characters (256 bits for HMAC-SHA256).
 * 3. Known Placeholder Blacklist: Common development placeholders and tutorial defaults are rejected.
 * 4. Character Diversity Sanity Check: Must contain at least 8 unique characters (rejects trivial repeats).
 * 5. Production Environment Guard: Known repository defaults are strictly forbidden in production.
 *
 * ENTROPY DISCLOSURE:
 * This validator measures structural length, character variety, and known-pattern exclusion.
 * Length alone does NOT prove information-theoretic entropy. Production secrets must be
 * generated with a cryptographically secure pseudorandom number generator (CSPRNG), such as
 * `crypto.randomBytes(32).toString('hex')`.
 *
 * @returns The validated JWT secret string.
 */
export function validateJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('FATAL: JWT_SECRET environment variable is required and must not be empty.');
  }

  const trimmed = secret.trim();

  // Reject known placeholder strings
  if (KNOWN_INSECURE_PLACEHOLDERS.has(trimmed.toLowerCase())) {
    throw new Error('FATAL: JWT_SECRET uses an insecure known placeholder value. A dedicated, random secret is required.');
  }

  // Minimum length check (256-bit requirement for HMAC-SHA256 as per RFC 7518 Section 3.2)
  if (trimmed.length < 32) {
    throw new Error(`FATAL: JWT_SECRET must be at least 32 characters (256 bits) in length. Current length is ${trimmed.length}.`);
  }

  // Character diversity check (prevents trivial repeating patterns such as "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  const uniqueChars = new Set(trimmed).size;
  if (uniqueChars < 8) {
    throw new Error('FATAL: JWT_SECRET has low character diversity (fewer than 8 unique characters). Use a cryptographically generated secret.');
  }

  // In production, forbid default dev repository secrets
  if (process.env.NODE_ENV === 'production' && trimmed === 'super_secret_jwt_key_for_this_project_123') {
    throw new Error('FATAL: Default development JWT_SECRET is not permitted in production environment.');
  }

  return trimmed;
}
