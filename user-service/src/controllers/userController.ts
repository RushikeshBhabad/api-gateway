import { Request, Response } from 'express';
import User from '../models/User';

/**
 * Retrieves the currently authenticated user's profile information.
 * Uses the user ID provided by the API Gateway in the 'x-user-id' header.
 * @param req - Express Request object containing 'x-user-id' header
 * @param res - Express Response object
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.headers['x-user-id'];
    const user = await User.findById(userId).select('-passwordHash');
    if (!user) {
       res.status(404).json({ success: false, error: { message: 'User not found' } });
       return;
    }
    res.status(200).json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
};

/**
 * Updates the currently authenticated user's profile information.
 * Only allows updating name and email fields.
 * @param req - Express Request object containing 'x-user-id' header and updated fields in body
 * @param res - Express Response object
 */
export const updateMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.headers['x-user-id'];
    const { name, email } = req.body;
    const user = await User.findByIdAndUpdate(userId, { name, email }, { new: true }).select('-passwordHash');
    res.status(200).json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { message: err.message } });
  }
};
