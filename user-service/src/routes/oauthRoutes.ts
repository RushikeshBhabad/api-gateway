import { Router } from 'express';
import passport from 'passport';
import { generateTokens } from '../services/authService';

const router = Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', passport.authenticate('google', { session: false, failureRedirect: '/login' }), async (req, res) => {
  try {
    const user: any = req.user;
    if (!user) return res.redirect('http://localhost:5173/login');
    
    const result = await generateTokens(user.id, user.role);
    res.cookie('refreshToken', result.refreshToken, { httpOnly: true, secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect(`http://localhost:5173/?accessToken=${result.accessToken}`);
  } catch (err) {
    res.redirect('http://localhost:5173/login');
  }
});

export default router;
