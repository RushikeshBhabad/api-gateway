import { Request, Response } from 'express';
import * as authService from '../services/authService';

/**
 * Handles user registration.
 * Validates the request body and creates a new user account.
 * @param req - Express Request containing name, email, password, and optionally role
 * @param res - Express Response object
 */
export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
       res.status(400).json({ success: false, error: { message: 'Missing fields' } });
       return;
    }
    const userRole = role === 'ADMIN' ? 'ADMIN' : 'USER';
    const user = await authService.signup(name, email, password, userRole);
    res.status(201).json({ success: true, data: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err: any) {
    const code = err.message === 'Email already in use' ? 'SIGNUP_FAILED' : 'INTERNAL_ERROR';
    res.status(400).json({ success: false, error: { code, message: err.message } });
  }
};

/**
 * Handles user login.
 * Validates credentials and returns JWT access token alongside a refresh token (via HttpOnly cookie & body).
 * @param req - Express Request containing email and password
 * @param res - Express Response object
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, error: { code: 'AUTH_FAILED', message: err.message } });
  }
};

/**
 * Handles token refresh.
 * Validates the provided refresh token and issues a new access and refresh token pair.
 * @param req - Express Request containing refreshToken in cookies or body
 * @param res - Express Response object
 */
export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    if (!refreshToken) {
       res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No refresh token' } });
       return;
    }

    const result = await authService.refreshTokens(refreshToken);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: err.message } });
  }
};

/**
 * Handles user logout.
 * Revokes the active refresh token and clears the HttpOnly cookie.
 * @param req - Express Request containing refreshToken in cookies or body
 * @param res - Express Response object
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    res.clearCookie('refreshToken');
    res.status(200).json({ success: true, message: 'Logged out' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
};
