'use strict';
// Repro for "[Persistence]: Failed to save data: undefined" — runs the exact
// field list from server.js saveData() against the real database backend.
const db = require('./database');
(async () => {
  await db.initPromise;
  const user = {
    id: 999999, // nonexistent id: UPDATE matches no rows, safe on the real file
    username: 'dbg',
    email: undefined,          // guests have no email
    gc_balance: 1000,
    password: 'x',
    sc_unplayed: 10,
    sc_played: 0,
    stripeAccountId: undefined, // never set
    kyc: { status: 'UNVERIFIED' }, // no tier/inquiryId/verifiedAt
    lastDailyClaim: 0,
    dailyStreak: 0,
    adsWatchedToday: 0,
    lastAdReset: 0,
    state: 'CA',
    vipTier: 'Bronze',
    totalWageredGC: 0,
    totalWageredSC: 0,
    rakebackAccruedSC: 0,
    geoIp: undefined,           // geo middleware never ran
    geoCountry: undefined,
    geoCity: undefined,
    registeredAt: undefined,
    passwordResetToken: undefined,
    passwordResetExpiry: undefined
  };
  try {
    await db.updateUser(user.id, {
      username: user.username,
      email: user.email,
      gc_balance: user.gc_balance,
      password: user.password,
      sc_unplayed: user.sc_unplayed,
      sc_played: user.sc_played,
      stripe_account_id: user.stripeAccountId,
      kyc_status: user.kyc?.status || 'UNVERIFIED',
      kyc_tier: user.kyc?.tier || 0,
      kyc_inquiry_id: user.kyc?.inquiryId,
      kyc_verified_at: user.kyc?.verifiedAt,
      kyc_rejection_reason: user.kyc?.rejectionReason,
      last_daily_claim: user.lastDailyClaim,
      daily_streak: user.dailyStreak,
      ads_watched_today: user.adsWatchedToday,
      last_ad_reset: user.lastAdReset,
      state: user.state,
      vip_tier: user.vipTier,
      total_wagered_gc: user.totalWageredGC,
      total_wagered_sc: user.totalWageredSC,
      rakeback_accrued_sc: user.rakebackAccruedSC,
      geo_ip: user.geoIp,
      geo_country: user.geoCountry,
      geo_city: user.geoCity,
      geo_is_vpn: user.geoIsVpn ? 1 : 0,
      geo_risk_score: user.geoRiskScore || 0,
      registered_at: user.registeredAt || user.createdAt || null,
      password_reset_token: user.passwordResetToken || null,
      password_reset_expiry: user.passwordResetExpiry || 0
    });
    console.log('updateUser OK');
  } catch (e) {
    console.log('THROWN typeof=', typeof e, 'ctor=', e && e.constructor ? e.constructor.name : '?');
    console.log('message=', e && e.message);
    console.log('value=', String(e));
    if (e && e.stack) console.log('stack=', e.stack.split('\n').slice(0, 4).join('\n'));
  }
  process.exit(0);
})();
