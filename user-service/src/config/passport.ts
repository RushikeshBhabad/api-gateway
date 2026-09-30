import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'dummy-client-id',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret',
  callbackURL: '/api/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ email: profile.emails?.[0].value });
    
    if (!user) {
      user = new User({
        name: profile.displayName,
        email: profile.emails?.[0].value,
        authProvider: 'GOOGLE',
        providerUserId: profile.id,
        role: 'USER'
      });
      await user.save();
    } else if (user.authProvider === 'LOCAL') {
       user.authProvider = 'GOOGLE';
       user.providerUserId = profile.id;
       await user.save();
    }
    
    return done(null, user);
  } catch (err: any) {
    return done(err, false);
  }
}));

export default passport;
