const appJson = require('./app.json');

/** Clés lues au démarrage Expo depuis `.env.local` — pas figees dans git. */
module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra ?? {}),
      orsApiKey: process.env.ORS_API_KEY ?? process.env.EXPO_PUBLIC_ORS_API_KEY ?? '',
    },
    android: {
      ...appJson.expo.android,
      config: {
        ...(appJson.expo.android.config ?? {}),
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
        },
      },
    },
  },
};
