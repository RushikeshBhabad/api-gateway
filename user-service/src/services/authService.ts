import User from '../models/User';
import RefreshToken from '../models/RefreshToken';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ACCESS_TOKEN_EXP = '2h';
const REFRESH_TOKEN_EXP_DAYS = 7;

/**
 * Registers a new user with a hashed password.
 * @param name - The user's full name.
 * @param email - The user's email address.
 * @param password - The user's plain text password.
 * @param role - The user's role (default 'USER').
 * @returns The newly created user document.
 */
export const signup = async (name: string, email: string, password: string, role = 'USER') => {
  const existingUser = await User.findOne({ email });
  if (existingUser) throw new Error('Email already in use');

  const passwordHash = await argon2.hash(password);
  const user = new User({ name, email, passwordHash, role });
  await user.save();
  return user;
};

/**
 * Authenticates a user and generates access/refresh tokens.
 * @param email - The user's email address.
 * @param password - The user's plain text password.
 * @returns An object containing the generated tokens and user details.
 */
export const login = async (email: string, password: string) => {
  const user = await User.findOne({ email });
  if (!user) throw new Error('Invalid credentials');
  
  if (!user.passwordHash) throw new Error('Account uses a different authentication method');
  const isValid = await argon2.verify(user.passwordHash, password);
  if (!isValid) throw new Error('Invalid credentials');

  const tokens = await generateTokens(user.id, user.role);
  return { ...tokens, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
};

/**
 * Validates a refresh token and issues a new token pair.
 * @param refreshToken - The plain text refresh token provided by the client.
 * @returns An object containing the new tokens and user details.
 */
export const refreshTokens = async (refreshToken: string) => {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const tokenRecord = await RefreshToken.findOne({ tokenHash: hash });
  
  if (!tokenRecord) throw new Error('Invalid refresh token');
  if (tokenRecord.revokedAt) throw new Error('Token has been revoked');
  if (new Date() > tokenRecord.expiresAt) throw new Error('Token expired');
  
  tokenRecord.revokedAt = new Date();
  await tokenRecord.save();
  
  const user = await User.findById(tokenRecord.userId);
  if (!user) throw new Error('User not found');
  
  const tokens = await generateTokens(user.id, user.role);
  return { ...tokens, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
};

/**
 * Revokes an active refresh token, effectively logging the user out.
 * @param refreshToken - The plain text refresh token to revoke.
 */
export const logout = async (refreshToken: string) => {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const tokenRecord = await RefreshToken.findOne({ tokenHash: hash });
  if (tokenRecord) {
    tokenRecord.revokedAt = new Date();
    await tokenRecord.save();
  }
};

/**
 * Generates an access token and a refresh token for a user.
 * @param userId - The unique identifier of the user.
 * @param role - The role of the user (e.g., 'USER', 'ADMIN').
 * @returns An object containing the JWT access token and plain text refresh token.
 */
export const generateTokens = async (userId: string, role: string) => {
  const secret = process.env.JWT_SECRET || 'super_secret_jwt_key_for_this_project_123';
  const accessToken = jwt.sign({ sub: userId, role }, secret, { expiresIn: ACCESS_TOKEN_EXP });
  
  const rawRefreshToken = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXP_DAYS);
  
  await RefreshToken.create({
    userId,
    tokenHash: hash,
    expiresAt
  });
  
  return { accessToken, refreshToken: rawRefreshToken };
};
